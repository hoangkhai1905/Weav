package com.weav.workflow;

import com.weav.workflow.infrastructure.persistence.entity.AgentRunJpaEntity;
import com.weav.workflow.domain.valueobject.AgentRunStatus;
import com.weav.workflow.infrastructure.persistence.entity.AgentStepJpaEntity;
import com.weav.workflow.domain.valueobject.AgentStepDecisionType;
import com.weav.workflow.domain.valueobject.AgentStepStatus;
import com.weav.workflow.domain.valueobject.AttemptStatus;
import com.weav.workflow.infrastructure.persistence.entity.ExecutionLogJpaEntity;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import com.weav.workflow.domain.valueobject.LogLevel;
import com.weav.workflow.infrastructure.persistence.entity.NodeExecutionJpaEntity;
import com.weav.workflow.infrastructure.persistence.entity.NodeExecutionAttemptJpaEntity;
import com.weav.workflow.domain.valueobject.NodeExecutionStatus;
import com.weav.workflow.infrastructure.persistence.entity.OutboxEventJpaEntity;
import com.weav.workflow.domain.valueobject.OutboxStatus;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowJpaEntity;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowExecutionJpaEntity;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowFileJpaEntity;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowTriggerJpaEntity;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowVersionJpaEntity;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class WorkflowPersistenceTest {

    @Autowired
    private EntityManager entityManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void flywayMigrationCreatesWorkflowSchema() {
        Integer appliedMigrations = jdbcTemplate.queryForObject(
                "select count(*) from workflow.flyway_schema_history where version = '1' and success = true",
                Integer.class
        );

        assertEquals(1, appliedMigrations);
        assertTrue(Boolean.TRUE.equals(jdbcTemplate.queryForObject(
                "select exists (select 1 from information_schema.tables where table_schema = 'workflow' and table_name = 'agent_steps')",
                Boolean.class
        )));
    }

    @Test
    @Transactional
    void jpaPersistsAndReadsWorkflowExecutionEntities() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        WorkflowJpaEntity workflow = new WorkflowJpaEntity(
                workspaceId,
                "Invoice WorkflowJpaEntity",
                "1.0",
                objectMapper.readTree("{\"nodes\":[],\"edges\":[]}"),
                userId
        );
        workflow.setDescription("Persistence test");
        workflow.setEditorState(objectMapper.readTree("{\"viewport\":{\"zoom\":1}}"));
        entityManager.persist(workflow);

        WorkflowVersionJpaEntity version = new WorkflowVersionJpaEntity(
                workflow.getId(),
                1,
                objectMapper.readTree("{\"nodes\":[],\"edges\":[]}"),
                "1.0",
                userId
        );
        entityManager.persist(version);
        workflow.setCurrentVersionId(version.getId());

        WorkflowTriggerJpaEntity trigger = new WorkflowTriggerJpaEntity(
                workflow.getId(),
                version.getId(),
                "schedule-1",
                TriggerType.SCHEDULE,
                objectMapper.readTree("{\"cron\":\"0 8 * * *\"}")
        );
        entityManager.persist(trigger);

        WorkflowExecutionJpaEntity execution = new WorkflowExecutionJpaEntity(
                workflow.getId(),
                version.getId(),
                ExecutionTriggerType.SCHEDULE,
                trigger.getId(),
                null,
                objectMapper.readTree("{\"source\":\"test\"}")
        );
        entityManager.persist(execution);

        NodeExecutionJpaEntity nodeExecution = new NodeExecutionJpaEntity(
                execution.getId(),
                "node-1",
                "http.request",
                objectMapper.readTree("{\"url\":\"https://example.test\"}")
        );
        entityManager.persist(nodeExecution);

        NodeExecutionAttemptJpaEntity attempt = new NodeExecutionAttemptJpaEntity(
                nodeExecution.getId(),
                1,
                objectMapper.readTree("{\"url\":\"https://example.test\"}")
        );
        entityManager.persist(attempt);

        ExecutionLogJpaEntity log = new ExecutionLogJpaEntity(
                execution.getId(),
                nodeExecution.getId(),
                attempt.getId(),
                LogLevel.INFO,
                "NODE_STARTED",
                "Node started",
                objectMapper.readTree("{\"nodeId\":\"node-1\"}")
        );
        entityManager.persist(log);

        WorkflowFileJpaEntity file = new WorkflowFileJpaEntity(
                workspaceId,
                "workspace/" + workspaceId + "/invoice.pdf",
                "invoice.pdf",
                "application/pdf",
                2048L,
                userId,
                Instant.now().plusSeconds(3600)
        );
        entityManager.persist(file);

        OutboxEventJpaEntity outboxEvent = new OutboxEventJpaEntity(
                "WorkflowExecutionJpaEntity",
                execution.getId(),
                "execution.requested",
                objectMapper.readTree("{\"executionId\":\"" + execution.getId() + "\"}")
        );
        entityManager.persist(outboxEvent);

        AgentRunJpaEntity agentRun = new AgentRunJpaEntity(
                attempt.getId(),
                "Process the invoice",
                objectMapper.readTree("[\"gmail.send\"]"),
                objectMapper.readTree("{\"currentStep\":0}"),
                10
        );
        entityManager.persist(agentRun);

        AgentStepJpaEntity agentStep = new AgentStepJpaEntity(
                agentRun.getId(),
                1,
                AgentStepDecisionType.TOOL_CALL,
                AgentStepStatus.SUCCESS
        );
        agentStep.setToolName("gmail.send");
        agentStep.setToolArguments(objectMapper.readTree("{\"to\":\"test@example.com\"}"));
        agentStep.setToolResult(objectMapper.readTree("{\"sent\":true}"));
        entityManager.persist(agentStep);

        entityManager.flush();
        entityManager.clear();

        WorkflowJpaEntity persistedWorkflow = entityManager.find(WorkflowJpaEntity.class, workflow.getId());
        WorkflowVersionJpaEntity persistedVersion = entityManager.find(WorkflowVersionJpaEntity.class, version.getId());
        WorkflowTriggerJpaEntity persistedTrigger = entityManager.find(WorkflowTriggerJpaEntity.class, trigger.getId());
        WorkflowExecutionJpaEntity persistedExecution = entityManager.find(WorkflowExecutionJpaEntity.class, execution.getId());
        NodeExecutionJpaEntity persistedNode = entityManager.find(NodeExecutionJpaEntity.class, nodeExecution.getId());
        NodeExecutionAttemptJpaEntity persistedAttempt = entityManager.find(NodeExecutionAttemptJpaEntity.class, attempt.getId());
        ExecutionLogJpaEntity persistedLog = entityManager.find(ExecutionLogJpaEntity.class, log.getId());
        WorkflowFileJpaEntity persistedFile = entityManager.find(WorkflowFileJpaEntity.class, file.getId());
        OutboxEventJpaEntity persistedOutbox = entityManager.find(OutboxEventJpaEntity.class, outboxEvent.getId());
        AgentRunJpaEntity persistedAgentRun = entityManager.find(AgentRunJpaEntity.class, agentRun.getId());
        AgentStepJpaEntity persistedAgentStep = entityManager.find(AgentStepJpaEntity.class, agentStep.getId());

        assertNotNull(persistedWorkflow);
        assertEquals(WorkflowStatus.DRAFT, persistedWorkflow.getStatus());
        assertEquals(workspaceId, persistedWorkflow.getWorkspaceId());
        assertEquals("1.0", persistedWorkflow.getSchemaVersion());
        assertNotNull(persistedWorkflow.getCreatedAt());
        assertNotNull(persistedWorkflow.getUpdatedAt());

        assertNotNull(persistedVersion);
        assertEquals(1, persistedVersion.getVersionNumber());
        assertEquals(workflow.getId(), persistedVersion.getWorkflowId());

        assertNotNull(persistedTrigger);
        assertEquals(TriggerType.SCHEDULE, persistedTrigger.getType());
        assertEquals(TriggerStatus.ACTIVE, persistedTrigger.getStatus());

        assertNotNull(persistedExecution);
        assertEquals(ExecutionStatus.QUEUED, persistedExecution.getStatus());
        assertEquals(ExecutionTriggerType.SCHEDULE, persistedExecution.getTriggerType());

        assertNotNull(persistedNode);
        assertEquals(NodeExecutionStatus.PENDING, persistedNode.getStatus());
        assertEquals(0, persistedNode.getAttemptCount());

        assertNotNull(persistedAttempt);
        assertEquals(AttemptStatus.RUNNING, persistedAttempt.getStatus());

        assertNotNull(persistedLog);
        assertEquals(LogLevel.INFO, persistedLog.getLevel());

        assertNotNull(persistedFile);
        assertEquals("invoice.pdf", persistedFile.getFileName());
        assertEquals(2048L, persistedFile.getSizeBytes());

        assertNotNull(persistedOutbox);
        assertEquals(OutboxStatus.PENDING, persistedOutbox.getStatus());
        assertEquals(0, persistedOutbox.getRetryCount());

        assertNotNull(persistedAgentRun);
        assertEquals(AgentRunStatus.RUNNING, persistedAgentRun.getStatus());
        assertEquals(10, persistedAgentRun.getMaxSteps());

        assertNotNull(persistedAgentStep);
        assertEquals(AgentStepDecisionType.TOOL_CALL, persistedAgentStep.getDecisionType());
        assertEquals("gmail.send", persistedAgentStep.getToolName());
        assertEquals(true, persistedAgentStep.getToolResult().get("sent").asBoolean());
    }
}
