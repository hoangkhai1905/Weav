package com.weav.workflow;

import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.domain.exception.ForbiddenException;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.rabbitmq.RabbitMQContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@TestConfiguration(proxyBeanMethods = false)
public class WorkflowDraftTestConfiguration {

    @Bean
    @ServiceConnection
    PostgreSQLContainer workflowDraftPostgres() {
        return new PostgreSQLContainer(DockerImageName.parse("postgres:latest"));
    }

    @Bean
    @ServiceConnection
    RabbitMQContainer workflowDraftRabbit() {
        return new RabbitMQContainer(DockerImageName.parse("rabbitmq:latest"));
    }

    @Bean
    @Primary
    DraftWorkspaceBoundary draftWorkspaceBoundary() {
        return new DraftWorkspaceBoundary();
    }

    public static final class DraftWorkspaceBoundary implements WorkspaceAccessPort, WorkspaceConnectionPort {

        private volatile Set<String> capabilities = Set.of(
                "WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT");
        private volatile Set<UUID> deniedConnections = Set.of();
        private final Set<UUID> authorizedConnections = ConcurrentHashMap.newKeySet();

        @Override
        public Access getAccess(UUID workspaceId, UUID userId) {
            return new Access(workspaceId, userId, "MEMBER", capabilities);
        }

        @Override
        public void authorizeAttachment(UUID workspaceId, UUID connectionId, UUID userId) {
            if (deniedConnections.contains(connectionId)) {
                throw new ForbiddenException();
            }
            authorizedConnections.add(connectionId);
        }

        @Override
        public ResolvedConnection resolve(UUID workspaceId, UUID connectionId) {
            throw new UnsupportedOperationException("Draft tests do not resolve provider credentials");
        }

        @Override
        public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
            throw new UnsupportedOperationException("Draft tests do not report provider authentication failures");
        }

        public void setCapabilities(Set<String> capabilities) {
            this.capabilities = Set.copyOf(new LinkedHashSet<>(capabilities));
        }

        public void denyConnections(Set<UUID> connectionIds) {
            this.deniedConnections = Set.copyOf(connectionIds);
        }

        public Set<UUID> authorizedConnections() {
            return Set.copyOf(authorizedConnections);
        }

        public void reset() {
            capabilities = Set.of("WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT");
            deniedConnections = Set.of();
            authorizedConnections.clear();
        }
    }
}
