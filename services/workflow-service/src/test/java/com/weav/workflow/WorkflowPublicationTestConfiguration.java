package com.weav.workflow;

import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowTriggerJpaEntity;
import com.weav.workflow.infrastructure.persistence.repository.WorkflowTriggerAdapter;
import jakarta.persistence.EntityManager;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.boot.test.context.TestConfiguration;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.rabbitmq.RabbitMQContainer;
import org.testcontainers.utility.DockerImageName;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

@TestConfiguration(proxyBeanMethods = false)
public class WorkflowPublicationTestConfiguration {

    @Bean
    @ServiceConnection
    PostgreSQLContainer workflowPublicationPostgres() {
        return new PostgreSQLContainer(DockerImageName.parse("postgres:latest"));
    }

    @Bean
    @ServiceConnection
    RabbitMQContainer workflowPublicationRabbit() {
        return new RabbitMQContainer(DockerImageName.parse("rabbitmq:latest"));
    }

    @Bean
    @Primary
    PublicationWorkspaceAccess publicationWorkspaceAccess() {
        return new PublicationWorkspaceAccess();
    }

    @Bean
    @Primary
    PublicationWorkspaceConnections publicationWorkspaceConnections(PublicationAuthorizationGate gate) {
        return new PublicationWorkspaceConnections(gate);
    }

    @Bean
    PublicationAuthorizationGate publicationAuthorizationGate() {
        return new PublicationAuthorizationGate();
    }

    @Bean
    PublicationRollbackInjector publicationRollbackInjector() {
        return new PublicationRollbackInjector();
    }

    @Bean
    ScheduleScanGate scheduleScanGate() {
        return new ScheduleScanGate();
    }

    @Bean
    ScheduleAdvanceFailureInjector scheduleAdvanceFailureInjector() {
        return new ScheduleAdvanceFailureInjector();
    }

    @Bean
    @Primary
    WorkflowTriggerPort publicationWorkflowTriggerPort(
            WorkflowTriggerAdapter delegate,
            EntityManager entityManager,
            PublicationRollbackInjector rollbackInjector,
            ScheduleScanGate scheduleScanGate,
            ScheduleAdvanceFailureInjector scheduleAdvanceFailureInjector) {
        return new WorkflowTriggerPort() {
            @Override
            public void replaceCurrent(UUID workflowId, UUID versionId, java.util.List<WorkflowTrigger> triggers) {
                delegate.replaceCurrent(workflowId, versionId, triggers);
                if (rollbackInjector.failAfterTriggerReplacement()) {
                    entityManager.flush();
                    long disabledCount = entityManager.createQuery(
                                    "select count(trigger) from WorkflowTriggerJpaEntity trigger "
                                            + "where trigger.workflowId = :workflowId and trigger.status = :status",
                                    Long.class)
                            .setParameter("workflowId", workflowId)
                            .setParameter("status", TriggerStatus.DISABLED)
                            .getSingleResult();
                    rollbackInjector.recordDisabledTriggerCountBeforeFailure(Math.toIntExact(disabledCount));
                    throw new InjectedPublicationRollbackException();
                }
            }

            @Override
            public WorkflowTrigger find(UUID triggerId) {
                return delegate.find(triggerId);
            }

            @Override
            public Optional<WorkflowTrigger> findWebhookByEndpoint(String endpointKey) {
                return delegate.findWebhookByEndpoint(endpointKey);
            }

            @Override
            public List<WorkflowTrigger> findCurrent(UUID workflowId, UUID versionId) {
                return delegate.findCurrent(workflowId, versionId);
            }

            @Override
            public List<ScheduleCandidate> findDueSchedules(Instant now, int limit) {
                List<ScheduleCandidate> due = delegate.findDueSchedules(now, limit);
                scheduleScanGate.afterSelection();
                return due;
            }

            @Override
            public Optional<WorkflowTrigger> lockCurrent(UUID workflowId, UUID triggerId) {
                return delegate.lockCurrent(workflowId, triggerId);
            }

            @Override
            public void initializeSchedule(UUID triggerId, Instant nextRunAt) {
                delegate.initializeSchedule(triggerId, nextRunAt);
            }

            @Override
            public void advanceSchedule(UUID triggerId, Instant scheduledAt, Instant nextRunAt) {
                if (scheduleAdvanceFailureInjector.failNext()) {
                    throw new InjectedScheduleAdvanceFailureException();
                }
                delegate.advanceSchedule(triggerId, scheduledAt, nextRunAt);
            }

            @Override
            public void recordScheduleFailure(UUID triggerId, Instant retryAt) {
                delegate.recordScheduleFailure(triggerId, retryAt);
            }

            @Override
            public void setCurrentEnabled(UUID workflowId, UUID versionId, boolean enabled, Instant enabledAt,
                                          Map<UUID, Instant> nextRunAtByTrigger) {
                delegate.setCurrentEnabled(workflowId, versionId, enabled, enabledAt, nextRunAtByTrigger);
            }
        };
    }

    public static final class PublicationWorkspaceAccess implements WorkspaceAccessPort {
        private volatile Set<String> capabilities = defaultCapabilities();

        @Override
        public Access getAccess(UUID workspaceId, UUID userId) {
            return new Access(workspaceId, userId, "MEMBER", capabilities);
        }

        public void setCapabilities(Set<String> capabilities) {
            this.capabilities = Set.copyOf(new LinkedHashSet<>(capabilities));
        }

        public void reset() {
            capabilities = defaultCapabilities();
        }

        private static Set<String> defaultCapabilities() {
            return Set.of("WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT", "WORKFLOW_PUBLISH",
                    "WORKFLOW_MANAGE_STATE");
        }
    }

    public static final class PublicationWorkspaceConnections implements WorkspaceConnectionPort {
        private final PublicationAuthorizationGate gate;
        private volatile Set<UUID> deniedAttachments = Set.of();

        private PublicationWorkspaceConnections(PublicationAuthorizationGate gate) {
            this.gate = gate;
        }

        @Override
        public void authorizeAttachment(UUID workspaceId, UUID connectionId, UUID userId) {
            gate.beforeAttachmentAuthorization();
            if (deniedAttachments.contains(connectionId)) {
                throw new ForbiddenException();
            }
        }

        @Override
        public ResolvedConnection resolve(UUID workspaceId, UUID connectionId) {
            throw new UnsupportedOperationException("Publication tests do not resolve credentials");
        }

        @Override
        public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
            throw new UnsupportedOperationException("Publication tests do not report credential failures");
        }

        public void deny(Set<UUID> connectionIds) {
            deniedAttachments = Set.copyOf(connectionIds);
        }

        public void reset() {
            deniedAttachments = Set.of();
        }
    }

    public static final class PublicationAuthorizationGate {
        private final AtomicReference<Gate> active = new AtomicReference<>();

        public void arm() {
            arm(1);
        }

        /** Blocks the requested number of attachment checks before they may acquire workflow locks. */
        public void arm(int callers) {
            if (callers < 1) {
                throw new IllegalArgumentException("callers must be positive");
            }
            active.set(new Gate(callers));
        }

        public boolean awaitArrival(Duration timeout) throws InterruptedException {
            Gate gate = active.get();
            return gate != null && gate.entered().await(timeout.toMillis(), TimeUnit.MILLISECONDS);
        }

        public void release() {
            Gate gate = active.getAndSet(null);
            if (gate != null) {
                gate.release().countDown();
            }
        }

        public void reset() {
            release();
        }

        private void beforeAttachmentAuthorization() {
            Gate gate = active.get();
            if (gate == null || !gate.claimBlock()) {
                return;
            }
            gate.entered().countDown();
            try {
                if (!gate.release().await(20, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Publication authorization gate timed out");
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("Publication authorization gate was interrupted");
            }
        }

        private record Gate(CountDownLatch entered, CountDownLatch release, AtomicInteger remainingBlocks) {
            private Gate(int callers) {
                this(new CountDownLatch(callers), new CountDownLatch(1), new AtomicInteger(callers));
            }

            private boolean claimBlock() {
                int remaining;
                do {
                    remaining = remainingBlocks.get();
                    if (remaining == 0) {
                        return false;
                    }
                } while (!remainingBlocks.compareAndSet(remaining, remaining - 1));
                return true;
            }
        }
    }

    public static final class PublicationRollbackInjector {
        private final AtomicBoolean armed = new AtomicBoolean();
        private final AtomicInteger disabledTriggerCountBeforeFailure = new AtomicInteger(-1);

        public void arm() {
            disabledTriggerCountBeforeFailure.set(-1);
            armed.set(true);
        }

        public void reset() {
            armed.set(false);
            disabledTriggerCountBeforeFailure.set(-1);
        }

        private boolean failAfterTriggerReplacement() {
            return armed.compareAndSet(true, false);
        }

        private void recordDisabledTriggerCountBeforeFailure(int count) {
            disabledTriggerCountBeforeFailure.set(count);
        }

        public int disabledTriggerCountBeforeFailure() {
            return disabledTriggerCountBeforeFailure.get();
        }
    }

    public static final class InjectedPublicationRollbackException extends RuntimeException {
        public InjectedPublicationRollbackException() {
            super("Injected publication rollback");
        }
    }

    /** Test-only latch placed after durable candidate selection to overlap scanner instances. */
    public static final class ScheduleScanGate {
        private final AtomicReference<Gate> active = new AtomicReference<>();

        public void arm(int callers) {
            if (callers < 1) {
                throw new IllegalArgumentException("callers must be positive");
            }
            active.set(new Gate(callers));
        }

        public boolean awaitArrivals(Duration timeout) throws InterruptedException {
            Gate gate = active.get();
            return gate != null && gate.entered().await(timeout.toMillis(), TimeUnit.MILLISECONDS);
        }

        public void release() {
            Gate gate = active.getAndSet(null);
            if (gate != null) {
                gate.release().countDown();
            }
        }

        private void afterSelection() {
            Gate gate = active.get();
            if (gate == null || !gate.claim()) {
                return;
            }
            gate.entered().countDown();
            try {
                if (!gate.release().await(20, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Schedule scanner test gate timed out");
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("Schedule scanner test gate was interrupted");
            }
        }

        private record Gate(CountDownLatch entered, CountDownLatch release, AtomicInteger remaining) {
            private Gate(int callers) {
                this(new CountDownLatch(callers), new CountDownLatch(1), new AtomicInteger(callers));
            }

            private boolean claim() {
                int count;
                do {
                    count = remaining.get();
                    if (count == 0) {
                        return false;
                    }
                } while (!remaining.compareAndSet(count, count - 1));
                return true;
            }
        }
    }

    public static final class ScheduleAdvanceFailureInjector {
        private final AtomicBoolean armed = new AtomicBoolean();

        public void arm() {
            armed.set(true);
        }

        private boolean failNext() {
            return armed.compareAndSet(true, false);
        }
    }

    public static final class InjectedScheduleAdvanceFailureException extends RuntimeException {
        public InjectedScheduleAdvanceFailureException() {
            super("Injected schedule slot update failure");
        }
    }
}
