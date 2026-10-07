package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.application.port.out.GmailTriggerPort;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.domain.exception.ResourceNotFoundException;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowTriggerJpaEntity;
import com.weav.workflow.infrastructure.persistence.mapper.WorkflowPersistenceMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/** JPA adapter for current and historical workflow trigger registrations. */
@Repository
public class WorkflowTriggerAdapter implements WorkflowTriggerPort, GmailTriggerPort {
    private static final Pattern SQL_IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");

    @PersistenceContext
    private EntityManager entityManager;

    private final WorkflowPersistenceMapper mapper;
    private final String triggerTable;
    private final String workflowTable;
    private final java.time.Clock clock;

    public WorkflowTriggerAdapter(WorkflowPersistenceMapper mapper,
                                  @Value("${spring.jpa.properties.hibernate.default_schema:workflow}") String schema,
                                  @org.springframework.beans.factory.annotation.Qualifier("workflowExecutionClock")
                                  java.time.Clock clock) {
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
        this.mapper = Objects.requireNonNull(mapper, "mapper must not be null");
        if (schema == null || !SQL_IDENTIFIER.matcher(schema).matches()) {
            throw new IllegalArgumentException("The configured workflow schema name is invalid");
        }
        this.triggerTable = "\"" + schema + "\".workflow_triggers";
        this.workflowTable = "\"" + schema + "\".workflows";
    }

    @Override
    @Transactional
    public void replaceCurrent(UUID workflowId, UUID versionId, List<WorkflowTrigger> registrations) {
        Objects.requireNonNull(workflowId, "workflowId must not be null");
        Objects.requireNonNull(versionId, "versionId must not be null");
        Objects.requireNonNull(registrations, "registrations must not be null");

        List<WorkflowTriggerJpaEntity> previous = entityManager.createQuery(
                        "select trigger from WorkflowTriggerJpaEntity trigger "
                                + "where trigger.workflowId = :workflowId and trigger.status = :status",
                        WorkflowTriggerJpaEntity.class)
                .setParameter("workflowId", workflowId)
                .setParameter("status", TriggerStatus.ACTIVE)
                .getResultList();
        previous.forEach(trigger -> trigger.setStatus(TriggerStatus.DISABLED));

        for (WorkflowTrigger registration : registrations) {
            if (!workflowId.equals(registration.getWorkflowId())
                    || !versionId.equals(registration.getWorkflowVersionId())) {
                throw new IllegalArgumentException("Trigger registration must belong to the published workflow version");
            }
            entityManager.persist(mapper.toEntity(registration));
        }
    }

    @Override
    @Transactional(readOnly = true)
    public WorkflowTrigger find(UUID triggerId) {
        Objects.requireNonNull(triggerId, "triggerId must not be null");
        WorkflowTriggerJpaEntity entity = entityManager.find(WorkflowTriggerJpaEntity.class, triggerId);
        if (entity == null) {
            throw new ResourceNotFoundException("Workflow trigger not found");
        }
        return mapper.toDomain(entity);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<WorkflowTrigger> findWebhookByEndpoint(String endpointKey) {
        return findByEndpoint(endpointKey, com.weav.workflow.domain.valueobject.TriggerType.WEBHOOK);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<WorkflowTrigger> findTelegramByEndpoint(String endpointKey) {
        return findByEndpoint(endpointKey, com.weav.workflow.domain.valueobject.TriggerType.TELEGRAM);
    }

    private Optional<WorkflowTrigger> findByEndpoint(
            String endpointKey, com.weav.workflow.domain.valueobject.TriggerType type) {
        Objects.requireNonNull(endpointKey, "endpointKey must not be null");
        return entityManager.createQuery(
                        "select trigger from WorkflowTriggerJpaEntity trigger "
                                + "where trigger.endpointKey = :endpointKey and trigger.type = :type",
                        WorkflowTriggerJpaEntity.class)
                .setParameter("endpointKey", endpointKey)
                .setParameter("type", type)
                .setMaxResults(1)
                .getResultList()
                .stream()
                .findFirst()
                .map(mapper::toDomain);
    }

    @Override
    @Transactional
    public boolean isTelegramConnectionInUse(UUID connectionId, UUID excludingWorkflowId) {
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        Objects.requireNonNull(excludingWorkflowId, "excludingWorkflowId must not be null");
        String connection = connectionId.toString();
        entityManager.createNativeQuery("select pg_advisory_xact_lock(hashtextextended(:connection, 0))")
                .setParameter("connection", "telegram-bot:" + connection)
                .getSingleResult();
        Number matches = (Number) entityManager.createNativeQuery(
                        "select count(*) from " + triggerTable + " t "
                                + "join " + workflowTable + " w on w.id = t.workflow_id "
                                + "where t.type = 'TELEGRAM' and t.status = 'ACTIVE' and w.deleted_at is null "
                                + "and lower(t.config->>'connectionId') = :connection and t.workflow_id <> :workflowId")
                .setParameter("connection", connection)
                .setParameter("workflowId", excludingWorkflowId)
                .getSingleResult();
        return matches.longValue() > 0;
    }

    @Override
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.REQUIRES_NEW,
            readOnly = true)
    public boolean hasActiveTelegramTrigger(UUID connectionId) {
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        Number matches = (Number) entityManager.createNativeQuery(
                        "select count(*) from " + triggerTable + " t "
                                + "join " + workflowTable + " w on w.id = t.workflow_id "
                                + "where t.type = 'TELEGRAM' and t.status = 'ACTIVE' and w.deleted_at is null "
                                + "and lower(t.config->>'connectionId') = :connection")
                .setParameter("connection", connectionId.toString())
                .getSingleResult();
        return matches.longValue() > 0;
    }

    @Override
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.REQUIRES_NEW)
    public void updateTelegramRegistration(UUID triggerId, String newSecretHash, Map<String, Object> lastError) {
        Objects.requireNonNull(triggerId, "triggerId must not be null");
        WorkflowTriggerJpaEntity trigger = entityManager.find(WorkflowTriggerJpaEntity.class, triggerId);
        if (trigger == null || trigger.getType() != com.weav.workflow.domain.valueobject.TriggerType.TELEGRAM) {
            return;
        }
        if (newSecretHash != null) {
            if (newSecretHash.isBlank()) {
                throw new IllegalArgumentException("secretHash must not be blank");
            }
            trigger.setSecretHash(newSecretHash);
        }
        trigger.setLastError(lastError == null ? null : mapper.toJsonNode(lastError));
    }

    @Override
    @Transactional
    public void disableTelegramNotConfigured(UUID triggerId) {
        Objects.requireNonNull(triggerId, "triggerId must not be null");
        WorkflowTriggerJpaEntity trigger = entityManager.find(WorkflowTriggerJpaEntity.class, triggerId);
        if (trigger == null || trigger.getType() != com.weav.workflow.domain.valueobject.TriggerType.TELEGRAM) {
            return;
        }
        trigger.setStatus(TriggerStatus.DISABLED);
        trigger.setLastError(mapper.toJsonNode(Map.of("code", "DEPENDENCY_NOT_CONFIGURED")));
    }

    @Override
    @Transactional
    public void replaceSecretHash(UUID triggerId, String secretHash) {
        Objects.requireNonNull(triggerId, "triggerId must not be null");
        if (secretHash == null || secretHash.isBlank()) {
            throw new IllegalArgumentException("secretHash must not be blank");
        }
        WorkflowTriggerJpaEntity trigger = entityManager.find(WorkflowTriggerJpaEntity.class, triggerId);
        if (trigger == null || trigger.getEndpointKey() == null) {
            throw new ResourceNotFoundException("Workflow trigger not found");
        }
        trigger.setSecretHash(secretHash);
    }

    @Override
    @Transactional(readOnly = true)
    public List<WorkflowTrigger> findCurrent(UUID workflowId, UUID versionId) {
        Objects.requireNonNull(workflowId, "workflowId must not be null");
        Objects.requireNonNull(versionId, "versionId must not be null");
        return entityManager.createQuery(
                        "select trigger from WorkflowTriggerJpaEntity trigger "
                                + "where trigger.workflowId = :workflowId "
                                + "and trigger.workflowVersionId = :versionId "
                                + "order by trigger.createdAt, trigger.id",
                        WorkflowTriggerJpaEntity.class)
                .setParameter("workflowId", workflowId)
                .setParameter("versionId", versionId)
                .getResultList().stream().map(mapper::toDomain).toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<ScheduleCandidate> findDueSchedules(Instant now, int limit) {
        Objects.requireNonNull(now, "now must not be null");
        if (limit < 1 || limit > 1_000) {
            throw new IllegalArgumentException("Schedule scan limit must be between 1 and 1000");
        }
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery(
                        "select workflow_id, id from " + triggerTable + " "
                                + "where type = 'SCHEDULE' and status = 'ACTIVE' "
                                + "and (next_run_at is null or next_run_at <= :now) "
                                + "and (last_error is null or jsonb_typeof(last_error) <> 'object' "
                                + "or last_error->>'retryAt' is null "
                                + "or (last_error->>'retryAt')::timestamptz <= :now) "
                                + "order by coalesce((last_error->>'retryAt')::timestamptz, next_run_at) nulls first, id "
                                + "limit :limit")
                .setParameter("now", now)
                .setParameter("limit", limit)
                .getResultList();
        return rows.stream().map(row -> new ScheduleCandidate((UUID) row[0], (UUID) row[1])).toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<GmailTriggerPort.Candidate> findDueGmail(Instant now, int limit) {
        Objects.requireNonNull(now, "now must not be null");
        if (limit < 1 || limit > 1_000) {
            throw new IllegalArgumentException("Gmail poll limit must be between 1 and 1000");
        }
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery(
                        "select workflow_id, id from " + triggerTable + " "
                                + "where type = 'GMAIL' and status = 'ACTIVE' "
                                + "and next_run_at is not null and next_run_at <= :now "
                                + "order by next_run_at, id limit :limit")
                .setParameter("now", now)
                .setParameter("limit", limit)
                .getResultList();
        return rows.stream().map(row -> new GmailTriggerPort.Candidate((UUID) row[0], (UUID) row[1])).toList();
    }

    @Override
    @Transactional
    public void advanceGmailPoll(UUID triggerId, Instant nextPollAt) {
        WorkflowTriggerJpaEntity trigger = entityManager.find(WorkflowTriggerJpaEntity.class, triggerId);
        if (trigger == null || trigger.getType() != com.weav.workflow.domain.valueobject.TriggerType.GMAIL
                || trigger.getStatus() != TriggerStatus.ACTIVE) {
            return;
        }
        trigger.setNextRunAt(Objects.requireNonNull(nextPollAt, "nextPollAt must not be null"));
    }

    @Override
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.REQUIRES_NEW)
    public void recordGmailPoll(UUID triggerId, Instant newCursor, String lastMessageId, String lastErrorCode) {
        Objects.requireNonNull(triggerId, "triggerId must not be null");
        // Column-targeted statements: a full entity flush could overwrite next_run_at written by the next claim.
        if (newCursor != null) {
            entityManager.createNativeQuery("update " + triggerTable + " set poll_cursor = :cursor, "
                            + "last_triggered_at = :cursor, updated_at = :now "
                            + "where id = :id and type = 'GMAIL' and status = 'ACTIVE' "
                            + "and (poll_cursor is null or poll_cursor < :cursor)")
                    .setParameter("cursor", newCursor).setParameter("now", clock.instant())
                    .setParameter("id", triggerId).executeUpdate();
        }
        if (lastMessageId != null) {
            entityManager.createNativeQuery("update " + triggerTable + " set poll_cursor_message_id = :messageId, "
                            + "updated_at = :now where id = :id and type = 'GMAIL' and status = 'ACTIVE'")
                    .setParameter("messageId", lastMessageId).setParameter("now", clock.instant())
                    .setParameter("id", triggerId).executeUpdate();
        }
        String error = lastErrorCode == null ? null : mapper.toJsonNode(Map.of("code", lastErrorCode)).toString();
        entityManager.createNativeQuery("update " + triggerTable + " set last_error = cast(cast(:error as text) as jsonb), "
                        + "updated_at = :now where id = :id and type = 'GMAIL' and status = 'ACTIVE'")
                .setParameter("error", error).setParameter("now", clock.instant())
                .setParameter("id", triggerId).executeUpdate();
    }

    @Override
    @Transactional
    public Optional<WorkflowTrigger> lockCurrent(UUID workflowId, UUID triggerId) {
        Objects.requireNonNull(workflowId, "workflowId must not be null");
        Objects.requireNonNull(triggerId, "triggerId must not be null");
        List<WorkflowTriggerJpaEntity> matches = entityManager.createQuery(
                        "select trigger from WorkflowTriggerJpaEntity trigger "
                                + "where trigger.workflowId = :workflowId and trigger.id = :triggerId",
                        WorkflowTriggerJpaEntity.class)
                .setParameter("workflowId", workflowId)
                .setParameter("triggerId", triggerId)
                .setLockMode(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
                .setMaxResults(1)
                .getResultList();
        if (matches.isEmpty()) {
            return Optional.empty();
        }
        WorkflowTriggerJpaEntity locked = matches.getFirst();
        entityManager.refresh(locked, jakarta.persistence.LockModeType.PESSIMISTIC_WRITE);
        return Optional.of(mapper.toDomain(locked));
    }

    @Override
    @Transactional
    public void initializeSchedule(UUID triggerId, Instant nextRunAt) {
        WorkflowTriggerJpaEntity trigger = entityManager.find(WorkflowTriggerJpaEntity.class, triggerId);
        if (trigger == null || trigger.getType() != com.weav.workflow.domain.valueobject.TriggerType.SCHEDULE) {
            return;
        }
        trigger.setNextRunAt(Objects.requireNonNull(nextRunAt, "nextRunAt must not be null"));
    }

    @Override
    @Transactional
    public void advanceSchedule(UUID triggerId, Instant scheduledAt, Instant nextRunAt) {
        WorkflowTriggerJpaEntity trigger = entityManager.find(WorkflowTriggerJpaEntity.class, triggerId);
        if (trigger == null || trigger.getType() != com.weav.workflow.domain.valueobject.TriggerType.SCHEDULE) {
            return;
        }
        trigger.setLastTriggeredAt(Objects.requireNonNull(scheduledAt, "scheduledAt must not be null"));
        trigger.setNextRunAt(Objects.requireNonNull(nextRunAt, "nextRunAt must not be null"));
        trigger.setLastError(null);
    }

    @Override
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.REQUIRES_NEW)
    public void recordScheduleFailure(UUID triggerId, Instant retryAt) {
        Objects.requireNonNull(triggerId, "triggerId must not be null");
        Objects.requireNonNull(retryAt, "retryAt must not be null");
        WorkflowTriggerJpaEntity hint = entityManager.find(WorkflowTriggerJpaEntity.class, triggerId);
        if (hint == null || hint.getType() != com.weav.workflow.domain.valueobject.TriggerType.SCHEDULE) {
            return;
        }
        UUID workflowId = hint.getWorkflowId();
        List<com.weav.workflow.infrastructure.persistence.entity.WorkflowJpaEntity> workflows = entityManager.createQuery(
                        "select workflow from WorkflowJpaEntity workflow where workflow.id = :workflowId",
                        com.weav.workflow.infrastructure.persistence.entity.WorkflowJpaEntity.class)
                .setParameter("workflowId", workflowId)
                .setLockMode(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
                .setMaxResults(1)
                .getResultList();
        if (workflows.isEmpty()) {
            return;
        }
        entityManager.refresh(workflows.getFirst(), jakarta.persistence.LockModeType.PESSIMISTIC_WRITE);
        Optional<WorkflowTrigger> locked = lockCurrent(workflowId, triggerId);
        if (locked.isEmpty() || locked.get().getStatus() != TriggerStatus.ACTIVE) {
            return;
        }
        WorkflowTrigger domain = locked.get();
        domain.recordScheduleFailure(retryAt, clock.instant());
        WorkflowTriggerJpaEntity registration = entityManager.find(WorkflowTriggerJpaEntity.class, triggerId);
        registration.setLastError(mapper.toJsonNode(domain.getLastError()));
    }

    @Override
    @Transactional
    public void setCurrentEnabled(UUID workflowId, UUID versionId, boolean enabled, Instant enabledAt,
                                  Map<UUID, Instant> nextRunAtByTrigger) {
        Objects.requireNonNull(workflowId, "workflowId must not be null");
        Objects.requireNonNull(versionId, "versionId must not be null");
        Objects.requireNonNull(enabledAt, "enabledAt must not be null");
        Objects.requireNonNull(nextRunAtByTrigger, "nextRunAtByTrigger must not be null");
        List<WorkflowTriggerJpaEntity> current = entityManager.createQuery(
                        "select trigger from WorkflowTriggerJpaEntity trigger "
                                + "where trigger.workflowId = :workflowId and trigger.workflowVersionId = :versionId",
                        WorkflowTriggerJpaEntity.class)
                .setParameter("workflowId", workflowId)
                .setParameter("versionId", versionId)
                .getResultList();
        for (WorkflowTriggerJpaEntity trigger : current) {
            boolean hasReadinessError = trigger.getLastError() != null
                    && "DEPENDENCY_NOT_CONFIGURED".equals(trigger.getLastError().path("code").asString());
            boolean activate = enabled && !hasReadinessError;
            trigger.setStatus(activate ? TriggerStatus.ACTIVE : TriggerStatus.DISABLED);
            if (trigger.getType() == com.weav.workflow.domain.valueobject.TriggerType.GMAIL) {
                // Like schedules, mail that arrives while paused is not replayed: polling restarts at "now".
                trigger.setNextRunAt(activate ? enabledAt : null);
                trigger.setPollCursor(activate ? enabledAt : null);
                trigger.setPollCursorMessageId(null);
                if (activate) {
                    trigger.setLastError(null);
                }
                continue;
            }
            if (trigger.getType() == com.weav.workflow.domain.valueobject.TriggerType.SCHEDULE) {
                if (activate) {
                    Instant nextRunAt = nextRunAtByTrigger.get(trigger.getId());
                    if (nextRunAt == null || !nextRunAt.isAfter(enabledAt)) {
                        throw new IllegalArgumentException("Resumed schedules require a future next run instant");
                    }
                    trigger.setNextRunAt(nextRunAt);
                    trigger.setLastError(null);
                } else if (!enabled) {
                    trigger.setNextRunAt(null);
                }
            }
        }
    }
}
