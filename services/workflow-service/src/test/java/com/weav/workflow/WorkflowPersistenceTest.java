package com.weav.workflow;

import com.weav.workflow.infrastructure.persistence.entity.AgentRun;
import com.weav.workflow.infrastructure.persistence.entity.AgentRunStatus;
import com.weav.workflow.infrastructure.persistence.entity.AgentStep;
import com.weav.workflow.infrastructure.persistence.entity.AgentStepDecisionType;
import com.weav.workflow.infrastructure.persistence.entity.AgentStepStatus;
import com.weav.workflow.infrastructure.persistence.entity.AttemptStatus;
import com.weav.workflow.infrastructure.persistence.entity.ExecutionLog;
import com.weav.workflow.infrastructure.persistence.entity.ExecutionStatus;
import com.weav.workflow.infrastructure.persistence.entity.ExecutionTriggerType;
import com.weav.workflow.infrastructure.persistence.entity.LogLevel;
import com.weav.workflow.infrastructure.persistence.entity.NodeExecution;
import com.weav.workflow.infrastructure.persistence.entity.NodeExecutionAttempt;
import com.weav.workflow.infrastructure.persistence.entity.NodeExecutionStatus;
import com.weav.workflow.infrastructure.persistence.entity.OutboxEvent;
import com.weav.workflow.infrastructure.persistence.entity.OutboxStatus;
import com.weav.workflow.infrastructure.persistence.entity.TriggerStatus;
import com.weav.workflow.infrastructure.persistence.entity.TriggerType;
import com.weav.workflow.infrastructure.persistence.entity.Workflow;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowExecution;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowFile;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowStatus;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowTrigger;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowVersion;
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
        Workflow workflow = new Workflow(
                workspaceId,
                "Invoice Workflow",
                "1.0",
                objectMapper.readTree("{\"nodes\":[],\"edges\":[]}"),
                userId
        );
        workflow.setDescription("Persistence test");
        workflow.setEditorState(objectMapper.readTree("{\"viewport\":{\"zoom\":1}}"));
        entityManager.persist(workflow);

        WorkflowVersion version = new WorkflowVersion(
                workflow.getId(),
                1,
                objectMapper.readTree("{\"nodes\":[],\"edges\":[]}"),
                "1.0",
                userId
        );
        entityManager.persist(version);
        workflow.setCurrentVersionId(version.getId());

        WorkflowTrigger trigger = new WorkflowTrigger(
                workflow.getId(),
                version.getId(),
                "schedule-1",
                TriggerType.SCHEDULE,
                objectMapper.readTree("{\"cron\":\"0 8 * * *\"}")
        );
        entityManager.persist(trigger);

        WorkflowExecution execution = new WorkflowExecution(
                workflow.getId(),
                version.getId(),
                ExecutionTriggerType.SCHEDULE,
                trigger.getId(),
                null,
                objectMapper.readTree("{\"source\":\"test\"}")
        );
        entityManager.persist(execution);

        NodeExecution nodeExecution = new NodeExecution(
                execution.getId(),
                "node-1",
                "http.request",
                objectMapper.readTree("{\"url\":\"https://example.test\"}")
        );
        entityManager.persist(nodeExecution);

        NodeExecutionAttempt attempt = new NodeExecutionAttempt(
                nodeExecution.getId(),
                1,
                objectMapper.readTree("{\"url\":\"https://example.test\"}")
        );
        entityManager.persist(attempt);

        ExecutionLog log = new ExecutionLog(
                execution.getId(),
                nodeExecution.getId(),
                attempt.getId(),
                LogLevel.INFO,
                "NODE_STARTED",
                "Node started",
                objectMapper.readTree("{\"nodeId\":\"node-1\"}")
        );
        entityManager.persist(log);

        WorkflowFile file = new WorkflowFile(
                workspaceId,
                "workspace/" + workspaceId + "/invoice.pdf",
                "invoice.pdf",
                "application/pdf",
                2048L,
                userId,
                Instant.now().plusSeconds(3600)
        );
        entityManager.persist(file);

        OutboxEvent outboxEvent = new OutboxEvent(
                "WorkflowExecution",
                execution.getId(),
                "execution.requested",
                objectMapper.readTree("{\"executionId\":\"" + execution.getId() + "\"}")
        );
        entityManager.persist(outboxEvent);

        AgentRun agentRun = new AgentRun(
                attempt.getId(),
                "Process the invoice",
                objectMapper.readTree("[\"gmail.send\"]"),
                objectMapper.readTree("{\"currentStep\":0}"),
                10
        );
        entityManager.persist(agentRun);

        AgentStep agentStep = new AgentStep(
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

        Workflow persistedWorkflow = entityManager.find(Workflow.class, workflow.getId());
        WorkflowVersion persistedVersion = entityManager.find(WorkflowVersion.class, version.getId());
        WorkflowTrigger persistedTrigger = entityManager.find(WorkflowTrigger.class, trigger.getId());
        WorkflowExecution persistedExecution = entityManager.find(WorkflowExecution.class, execution.getId());
        NodeExecution persistedNode = entityManager.find(NodeExecution.class, nodeExecution.getId());
        NodeExecutionAttempt persistedAttempt = entityManager.find(NodeExecutionAttempt.class, attempt.getId());
        ExecutionLog persistedLog = entityManager.find(ExecutionLog.class, log.getId());
        WorkflowFile persistedFile = entityManager.find(WorkflowFile.class, file.getId());
        OutboxEvent persistedOutbox = entityManager.find(OutboxEvent.class, outboxEvent.getId());
        AgentRun persistedAgentRun = entityManager.find(AgentRun.class, agentRun.getId());
        AgentStep persistedAgentStep = entityManager.find(AgentStep.class, agentStep.getId());

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