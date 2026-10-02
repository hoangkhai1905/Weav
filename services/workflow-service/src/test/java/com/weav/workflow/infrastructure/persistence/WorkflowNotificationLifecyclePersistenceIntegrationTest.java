package com.weav.workflow.infrastructure.persistence;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.port.out.ExecutionAdmissionPort;
import com.weav.workflow.application.port.out.ExecutionStatePort;
import com.weav.workflow.application.notification.WorkflowNotificationEvent;
import com.weav.workflow.application.port.out.WorkflowNotificationOutboxStore;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.infrastructure.messaging.WorkflowNotificationOutboxPublisher;
import com.weav.workflow.infrastructure.messaging.RabbitExecutionConfiguration;
import com.weav.workflow.domain.execution.GraphState;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.model.aggregate.execution.NodeExecution;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import com.weav.workflow.domain.valueobject.NodeExecutionStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import tools.jackson.databind.ObjectMapper;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.rabbitmq.RabbitMQContainer;

import java.time.OffsetDateTime;
import java.time.Instant;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.ArrayList;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.file.Path;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(properties = {
        "weav.workflow.execution-outbox.initial-delay=3600000",
        "weav.workflow.execution-outbox.poll-interval=3600000",
        "weav.workflow.notification-outbox.publisher-enabled=true",
        "weav.workflow.notification-outbox.batch-size=100",
        "weav.workflow.notification-outbox.initial-delay=3600000",
        "weav.workflow.notification-outbox.poll-interval=3600000",
        "spring.rabbitmq.publisher-confirm-type=correlated",
        "spring.rabbitmq.publisher-returns=true",
        "spring.rabbitmq.template.mandatory=true"
})
@Import(WorkflowPublicationTestConfiguration.class)
class WorkflowNotificationLifecyclePersistenceIntegrationTest {

    @Autowired
    private WorkflowDraftService drafts;

    @Autowired
    private WorkflowPublicationService publications;

    @Autowired
    private WorkflowNotificationOutboxPublisher notificationPublisher;

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @Autowired
    private RabbitAdmin rabbitAdmin;

    @Autowired
    private WorkflowNotificationOutboxStore notificationOutbox;

    @Autowired
    @Qualifier("workflowPublicationPostgres")
    private PostgreSQLContainer postgresContainer;

    @Autowired
    @Qualifier("workflowPublicationRabbit")
    private RabbitMQContainer rabbitContainer;

    @Autowired
    private ExecutionAdmissionPort admissions;

    @Autowired
    private ExecutionStatePort executions;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private WorkflowPublicationTestConfiguration.PublicationWorkspaceAccess workspaceAccess;

    @Autowired
    private WorkflowPublicationTestConfiguration.PublicationRollbackInjector rollbackInjector;

    @BeforeEach
    void allowAuthorizedLifecycleMutations() {
        workspaceAccess.setCapabilities(Set.of(
                "WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT", "WORKFLOW_PUBLISH",
                "WORKFLOW_MANAGE_STATE", "WORKFLOW_MONITOR"));
    }

    @Test
    void authorizedDraftCreationCommitsOneStrictV2OutboxEvent() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        String workflowName = "Quarterly review";

        Workflow created = drafts.create(new CreateWorkflowCommand(
                workspaceId, actorId, workflowName, "Toast-only description"));

        Map<String, Object> row = jdbc.queryForMap("""
                SELECT event_id, event_type, workspace_id, recipient_user_id AS candidate_user_id, actor_user_id,
                       entity_kind, entity_id, requires_monitor_access, status, payload::text AS payload
                FROM workflow.notification_outbox
                WHERE entity_id = ?
                """, created.getId());
        @SuppressWarnings("unchecked")
        Map<String, Object> event = objectMapper.readValue((String) row.get("payload"), Map.class);

        assertEquals("workflow.created", row.get("event_type"));
        assertEquals(workspaceId, row.get("workspace_id"));
        assertEquals(actorId, row.get("candidate_user_id"));
        assertEquals(actorId, row.get("actor_user_id"));
        assertEquals("WORKFLOW", row.get("entity_kind"));
        assertEquals(created.getId(), row.get("entity_id"));
        assertEquals(false, row.get("requires_monitor_access"));
        assertEquals("PENDING", row.get("status"));

        assertEquals(Set.of("schemaVersion", "eventId", "eventType", "occurredAt", "producer",
                "actorUserId", "recipientUserIds", "workspaceId", "entity", "data"), event.keySet());
        assertEquals(2, event.get("schemaVersion"));
        assertEquals(row.get("event_id").toString(), event.get("eventId"));
        assertEquals("workflow.created", event.get("eventType"));
        assertTrue(OffsetDateTime.parse((String) event.get("occurredAt")).getOffset() != null);
        assertEquals("workflow-service", event.get("producer"));
        assertEquals(actorId.toString(), event.get("actorUserId"));
        assertEquals(List.of(actorId.toString()), event.get("recipientUserIds"));
        assertEquals(workspaceId.toString(), event.get("workspaceId"));
        assertEquals(Map.of("kind", "WORKFLOW", "id", created.getId().toString()), event.get("entity"));
        assertEquals(Map.of("workflowName", workflowName), event.get("data"));
    }

    @Test
    void lifecycleEventsFollowCommittedMilestonesAndSuppressNoOpStateChanges() {
        UUID workspaceId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        Workflow created = drafts.create(new CreateWorkflowCommand(
                workspaceId, actorId, "Lifecycle", null));

        publications.publish(workspaceId, created.getId(), actorId);
        publications.pause(workspaceId, created.getId(), actorId);
        publications.pause(workspaceId, created.getId(), actorId);
        publications.resume(workspaceId, created.getId(), actorId);
        publications.resume(workspaceId, created.getId(), actorId);

        assertEquals(List.of("workflow.created", "workflow.published", "workflow.paused", "workflow.resumed"),
                eventTypes(created.getId()));
    }

    @Test
    void republishingWhilePausedAddsOnlyTheNewPublicationMilestone() {
        UUID workspaceId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        Workflow created = drafts.create(new CreateWorkflowCommand(
                workspaceId, actorId, "Paused publication", null));
        publications.publish(workspaceId, created.getId(), actorId);
        publications.pause(workspaceId, created.getId(), actorId);

        publications.publish(workspaceId, created.getId(), actorId);

        assertEquals(List.of("workflow.created", "workflow.published", "workflow.paused", "workflow.published"),
                eventTypes(created.getId()));
        assertEquals("PAUSED", jdbc.queryForObject(
                "SELECT status FROM workflow.workflows WHERE id = ?", String.class, created.getId()));
    }

    @Test
    void publicationRollbackAlsoRollsBackItsNotificationRecord() {
        UUID workspaceId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        Workflow created = drafts.create(new CreateWorkflowCommand(
                workspaceId, actorId, "Rollback", null));
        rollbackInjector.arm();

        org.junit.jupiter.api.Assertions.assertThrows(
                WorkflowPublicationTestConfiguration.InjectedPublicationRollbackException.class,
                () -> publications.publish(workspaceId, created.getId(), actorId));

        assertEquals(List.of("workflow.created"), eventTypes(created.getId()));
        assertNull(jdbc.queryForObject(
                "SELECT current_version_id FROM workflow.workflows WHERE id = ?", UUID.class, created.getId()));
    }

    @Test
    void notificationInsertFailureRollsBackDraftCreation() {
        UUID workspaceId = UUID.randomUUID();
        String constraint = "task7_reject_" + UUID.randomUUID().toString().replace("-", "");
        jdbc.execute("ALTER TABLE workflow.notification_outbox ADD CONSTRAINT " + constraint
                + " CHECK (event_type <> 'workflow.created' OR workspace_id <> '" + workspaceId + "'::uuid)");
        try {
            org.junit.jupiter.api.Assertions.assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                    () -> drafts.create(new CreateWorkflowCommand(
                            workspaceId, UUID.randomUUID(), "Atomic create", null)));
        } finally {
            jdbc.execute("ALTER TABLE workflow.notification_outbox DROP CONSTRAINT " + constraint);
        }
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM workflow.workflows WHERE workspace_id = ?",
                Integer.class, workspaceId));
    }

    @Test
    void notificationInsertFailureRollsBackPublishedVersionAndWebhookRegistration() {
        UUID workspaceId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        Workflow created = drafts.create(new CreateWorkflowCommand(workspaceId, actorId, "Atomic publish", null));
        WorkflowDefinition webhookDefinition = new WorkflowDefinition("1.0", List.of(
                new WorkflowDefinition.Node("manual", "trigger.manual", Map.of()),
                new WorkflowDefinition.Node("webhook", "trigger.webhook", Map.of())), List.of(), Map.of());
        drafts.save(workspaceId, created.getId(), actorId, created.getName(), null, webhookDefinition, Map.of());
        String constraint = "task7_reject_" + UUID.randomUUID().toString().replace("-", "");
        jdbc.execute("ALTER TABLE workflow.notification_outbox ADD CONSTRAINT " + constraint
                + " CHECK (event_type <> 'workflow.published' OR entity_id <> '" + created.getId() + "'::uuid)");
        try {
            org.junit.jupiter.api.Assertions.assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                    () -> publications.publish(workspaceId, created.getId(), actorId));
        } finally {
            jdbc.execute("ALTER TABLE workflow.notification_outbox DROP CONSTRAINT " + constraint);
        }
        assertNull(jdbc.queryForObject(
                "SELECT current_version_id FROM workflow.workflows WHERE id = ?", UUID.class, created.getId()));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM workflow.workflow_versions WHERE workflow_id = ?",
                Integer.class, created.getId()));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM workflow.workflow_triggers WHERE workflow_id = ?",
                Integer.class, created.getId()));
        assertEquals(List.of("workflow.created"), eventTypes(created.getId()));
    }

    @Test
    void concurrentPauseRequestsProduceOneEventForTheSingleCommittedTransition() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        Workflow created = drafts.create(new CreateWorkflowCommand(workspaceId, actorId, "Concurrent pause", null));
        publications.publish(workspaceId, created.getId(), actorId);
        ExecutorService callers = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            Future<?> first = callers.submit(() -> changeStateTogether(workspaceId, created.getId(), actorId, ready, start));
            Future<?> second = callers.submit(() -> changeStateTogether(workspaceId, created.getId(), actorId, ready, start));
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
            first.get(10, TimeUnit.SECONDS);
            second.get(10, TimeUnit.SECONDS);
        } finally {
            start.countDown();
            callers.shutdownNow();
            assertTrue(callers.awaitTermination(10, TimeUnit.SECONDS));
        }
        assertEquals(1, jdbc.queryForObject("""
                SELECT count(*) FROM workflow.notification_outbox
                WHERE event_type = 'workflow.paused' AND entity_id = ?
                """, Integer.class, created.getId()));
        assertEquals("PAUSED", jdbc.queryForObject("SELECT status FROM workflow.workflows WHERE id = ?",
                String.class, created.getId()));
    }

    @Test
    void successfulFencedTerminalCommitRecordsOnlySafeResultAndManualInitiator() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID creatorId = UUID.randomUUID();
        UUID publisherId = UUID.randomUUID();
        UUID initiatorId = UUID.randomUUID();
        Workflow created = drafts.create(new CreateWorkflowCommand(
                workspaceId, creatorId, "Terminal result", "Do not notify this description"));
        publications.publish(workspaceId, created.getId(), publisherId);
        ExecutionAdmissionPort.Admission admission = admissions.create(new ExecutionAdmissionPort.Command(
                workspaceId, created.getId(), initiatorId, null, ExecutionTriggerType.MANUAL,
                Map.of("inputSecret", "must-not-leak"), null, null, null));
        ExecutionStatePort.Lease lease = executions.claim(admission.executionId(), "notification-test",
                java.time.Duration.ofSeconds(30)).orElseThrow();
        ExecutionStatePort.Snapshot snapshot = executions.load(lease);
        Instant finishedAt = Instant.parse("2026-09-27T09:15:30Z");
        Map<String, NodeExecutionStatus> statuses = new LinkedHashMap<>();
        List<NodeExecution> nodes = new java.util.ArrayList<>();
        for (NodeExecution node : snapshot.nodes().values()) {
            NodeExecution completed = new NodeExecution(node.getId(), node.getExecutionId(), node.getNodeId(),
                    node.getNodeType(), NodeExecutionStatus.SUCCESS, node.getInput(),
                    Map.of("providerToken", "must-not-leak"), null, 1, finishedAt, finishedAt,
                    node.getCreatedAt(), null);
            nodes.add(completed);
            statuses.put(node.getNodeId(), NodeExecutionStatus.SUCCESS);
        }
        ExecutionStatePort.Transition terminal = new ExecutionStatePort.Transition(
                new GraphState(statuses, snapshot.graph().edges()), nodes, snapshot.attempts(), Map.of(),
                ExecutionStatus.SUCCESS, Map.of("outputSecret", "must-not-leak"),
                Map.of("exception", "must-not-leak"), finishedAt, List.of());

        assertTrue(executions.commit(lease, terminal));
        assertFalse(executions.commit(lease, terminal));

        Map<String, Object> row = jdbc.queryForMap("""
                SELECT event_id, event_type, recipient_user_id AS candidate_user_id, actor_user_id, requires_monitor_access,
                       status, payload::text AS payload
                FROM workflow.notification_outbox WHERE entity_kind = 'EXECUTION' AND entity_id = ?
                """, admission.executionId());
        @SuppressWarnings("unchecked")
        Map<String, Object> event = objectMapper.readValue((String) row.get("payload"), Map.class);
        assertEquals("workflow.completed", row.get("event_type"));
        assertEquals(initiatorId, row.get("candidate_user_id"));
        assertEquals(initiatorId, row.get("actor_user_id"));
        assertEquals(true, row.get("requires_monitor_access"));
        assertEquals("PENDING", row.get("status"));
        assertEquals(finishedAt, OffsetDateTime.parse((String) event.get("occurredAt")).toInstant());
        assertEquals(List.of(initiatorId.toString()), event.get("recipientUserIds"));
        assertEquals(Map.of("kind", "EXECUTION", "id", admission.executionId().toString()), event.get("entity"));
        assertEquals(Map.of("workflowName", "Terminal result", "workflowId", created.getId().toString()),
                event.get("data"));
        String serialized = objectMapper.writeValueAsString(event);
        assertTrue(!serialized.contains("must-not-leak"));
        assertEquals(1, jdbc.queryForObject("""
                SELECT count(*) FROM workflow.notification_outbox
                WHERE entity_kind = 'EXECUTION' AND entity_id = ?
                """, Integer.class, admission.executionId()));
    }

    @Test
    void failedFencedTerminalCommitEmitsFailedWithoutPersistingRawErrorIntoEnvelope() throws Exception {
        UUID creatorId = UUID.randomUUID();
        TerminalFixture fixture = manualTerminalFixture("Failed result", creatorId,
                UUID.randomUUID(), UUID.randomUUID());
        Instant finishedAt = Instant.parse("2026-09-27T09:16:30Z");

        assertTrue(executions.commit(fixture.lease(), terminalTransition(
                fixture.snapshot(), ExecutionStatus.FAILED, finishedAt)));

        Map<String, Object> row = jdbc.queryForMap("""
                SELECT event_type, recipient_user_id, actor_user_id, payload::text AS payload
                FROM workflow.notification_outbox WHERE entity_id = ? AND entity_kind = 'EXECUTION'
                """, fixture.admission().executionId());
        assertEquals("workflow.failed", row.get("event_type"));
        assertEquals(fixture.initiatorId(), row.get("recipient_user_id"));
        assertEquals(fixture.initiatorId(), row.get("actor_user_id"));
        assertTrue(!((String) row.get("payload")).contains("private-error-details"));
    }

    @Test
    void expiredWorkerCannotRecordATerminalNotification() {
        TerminalFixture fixture = manualTerminalFixture("Expired lease", UUID.randomUUID(),
                UUID.randomUUID(), UUID.randomUUID());
        jdbc.update("UPDATE workflow.workflow_executions SET lease_until = CURRENT_TIMESTAMP - INTERVAL '1 second' "
                + "WHERE id = ?", fixture.admission().executionId());

        assertFalse(executions.commit(fixture.lease(), terminalTransition(
                fixture.snapshot(), ExecutionStatus.SUCCESS, Instant.now())));
        assertEquals(0, notificationCount(fixture.admission().executionId()));
        assertEquals("RUNNING", jdbc.queryForObject("SELECT status FROM workflow.workflow_executions WHERE id = ?",
                String.class, fixture.admission().executionId()));
    }

    @Test
    void cancelledExecutionNeverCreatesATerminalNotification() {
        TerminalFixture fixture = manualTerminalFixture("Cancelled execution", UUID.randomUUID(),
                UUID.randomUUID(), UUID.randomUUID());

        ExecutionStatePort.Transition cancelled = terminalTransition(
                fixture.snapshot(), ExecutionStatus.CANCELLED, Instant.now());
        assertTrue(executions.commit(fixture.lease(), cancelled));
        assertEquals(0, notificationCount(fixture.admission().executionId()));
        assertEquals("CANCELLED", jdbc.queryForObject("SELECT status FROM workflow.workflow_executions WHERE id = ?",
                String.class, fixture.admission().executionId()));
    }

    @Test
    void notificationInsertFailureRollsBackTheWinningExecutionTransition() {
        TerminalFixture fixture = manualTerminalFixture("Atomic terminal write", UUID.randomUUID(),
                UUID.randomUUID(), UUID.randomUUID());
        String constraint = "task7_reject_" + UUID.randomUUID().toString().replace("-", "");
        jdbc.execute("ALTER TABLE workflow.notification_outbox ADD CONSTRAINT " + constraint
                + " CHECK (event_type <> 'workflow.completed' OR entity_id <> '"
                + fixture.admission().executionId() + "'::uuid)");
        try {
            org.junit.jupiter.api.Assertions.assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                    () -> executions.commit(fixture.lease(), terminalTransition(
                            fixture.snapshot(), ExecutionStatus.SUCCESS, Instant.now())));
        } finally {
            jdbc.execute("ALTER TABLE workflow.notification_outbox DROP CONSTRAINT " + constraint);
        }

        assertEquals("RUNNING", jdbc.queryForObject("SELECT status FROM workflow.workflow_executions WHERE id = ?",
                String.class, fixture.admission().executionId()));
        assertEquals(0, notificationCount(fixture.admission().executionId()));
    }

    @Test
    void automaticTerminalRecipientIsTheCreatorNotTheVersionPublisher() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID creatorId = UUID.randomUUID();
        UUID versionPublisherId = UUID.randomUUID();
        Workflow workflow = drafts.create(new CreateWorkflowCommand(workspaceId, creatorId, "Automatic", null));
        WorkflowDefinition definition = new WorkflowDefinition("1.0", List.of(
                new WorkflowDefinition.Node("manual", "trigger.manual", Map.of()),
                new WorkflowDefinition.Node("webhook", "trigger.webhook", Map.of())), List.of(), Map.of());
        drafts.save(workspaceId, workflow.getId(), creatorId, workflow.getName(), null, definition, Map.of());
        publications.publish(workspaceId, workflow.getId(), versionPublisherId);
        UUID triggerId = jdbc.queryForObject("""
                SELECT id FROM workflow.workflow_triggers WHERE workflow_id = ? AND type = 'WEBHOOK'
                """, UUID.class, workflow.getId());
        ExecutionAdmissionPort.Admission admission = admissions.create(new ExecutionAdmissionPort.Command(
                workspaceId, workflow.getId(), null, triggerId, ExecutionTriggerType.WEBHOOK,
                Map.of("requestToken", "never-notify"), null, null, null));
        ExecutionStatePort.Lease lease = executions.claim(admission.executionId(), "automatic-notification-test",
                java.time.Duration.ofSeconds(30)).orElseThrow();
        ExecutionStatePort.Snapshot snapshot = executions.load(lease);
        assertTrue(executions.commit(lease, terminalTransition(
                snapshot, ExecutionStatus.SUCCESS, Instant.parse("2026-09-27T09:17:30Z"))));

        Map<String, Object> row = jdbc.queryForMap("""
                SELECT recipient_user_id, actor_user_id, payload::text AS payload
                FROM workflow.notification_outbox WHERE entity_id = ? AND entity_kind = 'EXECUTION'
                """, admission.executionId());
        assertEquals(creatorId, row.get("recipient_user_id"));
        assertNull(row.get("actor_user_id"));
        assertTrue(!((String) row.get("payload")).contains("never-notify"));
    }

    @Test
    void missingTerminalCandidateIsPersistedAsSkippedWithoutInventingARecipient() {
        UUID workspaceId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        UUID executionId = UUID.randomUUID();

        notificationOutbox.record(WorkflowNotificationEvent.terminal("workflow.completed", workspaceId,
                null, null, executionId, workflowId, "No candidate", Instant.now()));

        Map<String, Object> row = jdbc.queryForMap("""
                SELECT event_type, recipient_user_id, requires_monitor_access, payload, status, last_reason_code
                FROM workflow.notification_outbox WHERE entity_kind = 'EXECUTION' AND entity_id = ?
                """, executionId);
        assertEquals("workflow.completed", row.get("event_type"));
        assertNull(row.get("recipient_user_id"));
        assertEquals(true, row.get("requires_monitor_access"));
        assertNull(row.get("payload"));
        assertEquals("SKIPPED", row.get("status"));
        assertEquals("MISSING_CANDIDATE_USER", row.get("last_reason_code"));
    }

    @Test
    void unroutableTerminalNotificationStaysPendingWithSafeRetryReason() {
        rabbitAdmin.deleteQueue("notification-service.execution-events");
        TerminalFixture fixture = manualTerminalFixture("Unroutable result", UUID.randomUUID(),
                UUID.randomUUID(), UUID.randomUUID());
        assertTrue(executions.commit(fixture.lease(), terminalTransition(
                fixture.snapshot(), ExecutionStatus.SUCCESS, Instant.now())));

        notificationPublisher.publishPending();

        Map<String, Object> row = jdbc.queryForMap("""
                SELECT status, retry_count, last_reason_code FROM workflow.notification_outbox
                WHERE entity_kind = 'EXECUTION' AND entity_id = ?
                """, fixture.admission().executionId());
        assertEquals("PENDING", row.get("status"));
        assertEquals(1, row.get("retry_count"));
        assertEquals("UNROUTABLE", row.get("last_reason_code"));
    }

    @Test
    void expiredNotificationClaimReplaysTheSameIdAndEnvelopeOnce() throws Exception {
        String queueName = "task7-notification-restart-" + UUID.randomUUID();
        Queue queue = new Queue(queueName, true, false, false);
        rabbitAdmin.declareQueue(queue);
        rabbitAdmin.declareBinding(BindingBuilder.bind(queue)
                .to(new TopicExchange("weav.events", true, false)).with("workflow.paused"));
        UUID workspaceId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        notificationOutbox.record(WorkflowNotificationEvent.lifecycle("workflow.paused", workspaceId,
                actorId, workflowId, "Restart replay", Instant.parse("2026-09-27T09:20:00Z")));
        Map<String, Object> before = jdbc.queryForMap("""
                SELECT event_id, payload::text AS payload FROM workflow.notification_outbox
                WHERE event_type = 'workflow.paused' AND entity_id = ?
                """, workflowId);
        jdbc.update("""
                UPDATE workflow.notification_outbox
                SET status = 'CLAIMED', claim_token = ?, lease_until = CURRENT_TIMESTAMP - INTERVAL '1 second'
                WHERE event_id = ?
                """, UUID.randomUUID(), before.get("event_id"));

        notificationPublisher.publishPending();

        Map<String, Object> after = jdbc.queryForMap("""
                SELECT event_id, payload::text AS payload, status FROM workflow.notification_outbox
                WHERE event_type = 'workflow.paused' AND entity_id = ?
                """, workflowId);
        assertEquals(before.get("event_id"), after.get("event_id"));
        assertEquals(before.get("payload"), after.get("payload"));
        assertEquals("PUBLISHED", after.get("status"));
        int matched = 0;
        long deadline = System.nanoTime() + java.time.Duration.ofSeconds(5).toNanos();
        while (System.nanoTime() < deadline) {
            Message message = rabbitTemplate.receive(queueName, 100);
            if (message != null && before.get("event_id").toString()
                    .equals(message.getMessageProperties().getMessageId())) {
                matched++;
            }
        }
        assertEquals(1, matched);
    }

    @Test
    void concurrentPublishersClaimAndDeliverOneNotificationOnce() throws Exception {
        String queueName = "task7-notification-concurrent-" + UUID.randomUUID();
        Queue queue = new Queue(queueName, true, false, false);
        rabbitAdmin.declareQueue(queue);
        rabbitAdmin.declareBinding(BindingBuilder.bind(queue)
                .to(new TopicExchange("weav.events", true, false)).with("workflow.created"));
        UUID workspaceId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        notificationOutbox.record(WorkflowNotificationEvent.lifecycle("workflow.created", workspaceId,
                actorId, workflowId, "Concurrent delivery", Instant.now()));
        UUID eventId = jdbc.queryForObject("""
                SELECT event_id FROM workflow.notification_outbox WHERE event_type = 'workflow.created'
                AND entity_id = ?
                """, UUID.class, workflowId);
        ExecutorService callers = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            Future<?> first = callers.submit(() -> publishTogether(ready, start));
            Future<?> second = callers.submit(() -> publishTogether(ready, start));
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
            first.get(15, TimeUnit.SECONDS);
            second.get(15, TimeUnit.SECONDS);
        } finally {
            start.countDown();
            callers.shutdownNow();
            assertTrue(callers.awaitTermination(10, TimeUnit.SECONDS));
        }
        assertEquals("PUBLISHED", jdbc.queryForObject(
                "SELECT status FROM workflow.notification_outbox WHERE event_id = ?", String.class, eventId));
        int matched = 0;
        long deadline = System.nanoTime() + java.time.Duration.ofSeconds(5).toNanos();
        while (System.nanoTime() < deadline) {
            Message message = rabbitTemplate.receive(queueName, 100);
            if (message != null && eventId.toString().equals(message.getMessageProperties().getMessageId())) {
                matched++;
            }
        }
        assertEquals(1, matched);
    }

    @Test
    void lifecycleOutboxPublishesPersistentV2MessageOnItsEventTypeRoute() throws Exception {
        String queueName = "task7-workflow-created-" + UUID.randomUUID();
        Queue queue = new Queue(queueName, true, false, false);
        rabbitAdmin.declareQueue(queue);
        rabbitAdmin.declareBinding(BindingBuilder.bind(queue)
                .to(new TopicExchange("weav.events", true, false)).with("workflow.created"));

        UUID workspaceId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        Workflow created = drafts.create(new CreateWorkflowCommand(workspaceId, actorId, "Rabbit delivery", null));
        UUID eventId = jdbc.queryForObject("""
                SELECT event_id FROM workflow.notification_outbox
                WHERE event_type = 'workflow.created' AND entity_id = ?
                """, UUID.class, created.getId());

        notificationPublisher.publishPending();

        Map<String, Object> delivery = jdbc.queryForMap("""
                SELECT status, retry_count, last_reason_code FROM workflow.notification_outbox WHERE event_id = ?
                """, eventId);
        assertEquals("PUBLISHED", delivery.get("status"), delivery.toString());
        Message found = null;
        long deadline = System.nanoTime() + java.time.Duration.ofSeconds(5).toNanos();
        while (System.nanoTime() < deadline && found == null) {
            Message candidate = rabbitTemplate.receive(queueName, 200);
            if (candidate != null && eventId.toString().equals(candidate.getMessageProperties().getMessageId())) {
                found = candidate;
            }
        }
        assertTrue(found != null, "the matching durable event should arrive on the Notification route");
        assertEquals(org.springframework.amqp.core.MessageDeliveryMode.PERSISTENT,
                found.getMessageProperties().getReceivedDeliveryMode());
        assertEquals("application/json", found.getMessageProperties().getContentType());
        @SuppressWarnings("unchecked")
        Map<String, Object> event = objectMapper.readValue(
                new String(found.getBody(), StandardCharsets.UTF_8), Map.class);
        assertEquals(eventId.toString(), event.get("eventId"));
        assertEquals("workflow.created", event.get("eventType"));
        assertEquals(Map.of("kind", "WORKFLOW", "id", created.getId().toString()), event.get("entity"));
    }

    @Test
    void compiledNotificationConsumerPersistsAllSixV2EventsInJwtScopedInbox() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID creatorId = UUID.randomUUID();
        UUID initiatorId = UUID.randomUUID();
        String businessName = " ".repeat(200) + "Report";
        NotificationRuntimeBridge bridge = startNotificationBridge(creatorId, initiatorId);
        try {
            Workflow created = drafts.create(new CreateWorkflowCommand(
                    workspaceId, creatorId, businessName, "never-notify-description"));
            assertEquals(businessName, created.getName());
            assertEquals(businessName, jdbc.queryForObject(
                    "SELECT name FROM workflow.workflows WHERE id = ?", String.class, created.getId()));
            publications.publish(workspaceId, created.getId(), creatorId);
            publications.pause(workspaceId, created.getId(), creatorId);
            publications.resume(workspaceId, created.getId(), creatorId);
            UUID completedExecutionId = runManualExecution(workspaceId, created.getId(), initiatorId,
                    ExecutionStatus.SUCCESS);
            UUID failedExecutionId = runManualExecution(workspaceId, created.getId(), initiatorId,
                    ExecutionStatus.FAILED);

            Set<String> expectedTypes = Set.of("workflow.created", "workflow.published", "workflow.paused",
                    "workflow.resumed", "workflow.completed", "workflow.failed");
            List<Map<String, Object>> workflowEvents = jdbc.queryForList("""
                    SELECT event_id, event_type, payload::text AS payload
                    FROM workflow.notification_outbox WHERE workspace_id = ? ORDER BY sequence_id
                    """, workspaceId);
            assertEquals(expectedTypes, workflowEvents.stream()
                    .map(row -> (String) row.get("event_type")).collect(java.util.stream.Collectors.toSet()));
            assertEquals(1, workflowEvents.stream()
                    .filter(row -> "workflow.created".equals(row.get("event_type"))).count());
            for (Map<String, Object> row : workflowEvents) {
                @SuppressWarnings("unchecked")
                Map<String, Object> event = objectMapper.readValue((String) row.get("payload"), Map.class);
                assertEquals(Set.of("schemaVersion", "eventId", "eventType", "occurredAt", "producer",
                        "actorUserId", "recipientUserIds", "workspaceId", "entity", "data"), event.keySet());
                assertEquals(row.get("event_id").toString(), event.get("eventId"));
                assertTrue(!((String) row.get("payload")).contains("never-notify"));
                @SuppressWarnings("unchecked")
                Map<String, Object> data = (Map<String, Object>) event.get("data");
                assertEquals("Report", data.get("workflowName"));
            }
            assertEquals("SUCCESS", jdbc.queryForObject(
                    "SELECT status FROM workflow.workflow_executions WHERE id = ?", String.class,
                    completedExecutionId));
            assertEquals("FAILED", jdbc.queryForObject(
                    "SELECT status FROM workflow.workflow_executions WHERE id = ?", String.class,
                    failedExecutionId));
            assertEquals(1, jdbc.queryForObject("""
                    SELECT count(*) FROM workflow.notification_outbox
                    WHERE entity_kind = 'EXECUTION' AND entity_id = ? AND event_type = 'workflow.completed'
                    """, Integer.class, completedExecutionId));
            assertEquals(1, jdbc.queryForObject("""
                    SELECT count(*) FROM workflow.notification_outbox
                    WHERE entity_kind = 'EXECUTION' AND entity_id = ? AND event_type = 'workflow.failed'
                    """, Integer.class, failedExecutionId));

            notificationPublisher.publishPending();
            awaitInboxCount(workspaceId, 6, java.time.Duration.ofSeconds(15));

            List<Map<String, Object>> inboxRows = jdbc.queryForList("""
                    SELECT source_event_id, event_type, user_id, execution_id, content::text AS content
                    FROM notification.notification_inbox WHERE workspace_id = ?
                    """, workspaceId);
            assertEquals(6, inboxRows.size());
            assertEquals(4, inboxRows.stream().filter(row -> creatorId.equals(row.get("user_id"))).count());
            assertEquals(2, inboxRows.stream().filter(row -> initiatorId.equals(row.get("user_id"))).count());
            assertEquals(0, jdbc.queryForObject("""
                    SELECT count(*) FROM notification.notification_deliveries
                    WHERE source_event_id IN (
                        SELECT source_event_id FROM notification.notification_inbox WHERE workspace_id = ?)
                    """, Integer.class, workspaceId));
            for (Map<String, Object> row : inboxRows) {
                String eventType = (String) row.get("event_type");
                @SuppressWarnings("unchecked")
                Map<String, Object> content = objectMapper.readValue((String) row.get("content"), Map.class);
                @SuppressWarnings("unchecked")
                Map<String, Object> english = (Map<String, Object>) content.get("en");
                @SuppressWarnings("unchecked")
                Map<String, Object> target = (Map<String, Object>) english.get("target");
                assertTrue(!((String) row.get("content")).contains("never-notify"));
                if (Set.of("workflow.created", "workflow.published", "workflow.paused", "workflow.resumed")
                        .contains(eventType)) {
                    assertEquals("WORKFLOW", target.get("kind"));
                    assertEquals(created.getId().toString(), target.get("workflowId"));
                } else {
                    assertEquals("EXECUTION", target.get("kind"));
                    assertTrue(Set.of(completedExecutionId.toString(), failedExecutionId.toString())
                            .contains(target.get("executionId")));
                }
            }

            List<Map<String, Object>> creatorInbox = getInbox(bridge, bridge.creatorToken());
            List<Map<String, Object>> initiatorInbox = getInbox(bridge, bridge.initiatorToken());
            assertEquals(4, creatorInbox.size());
            assertEquals(4, creatorInbox.stream().filter(item -> item.get("eventType") instanceof String).count());
            assertTrue(creatorInbox.stream().allMatch(item ->
                    Set.of("workflow.created", "workflow.published", "workflow.paused", "workflow.resumed")
                            .contains(item.get("eventType"))));
            assertEquals(2, initiatorInbox.size());
            assertTrue(initiatorInbox.stream().allMatch(item ->
                    Set.of("workflow.completed", "workflow.failed").contains(item.get("eventType"))));

            Map<String, Object> completedOutbox = jdbc.queryForMap("""
                    SELECT event_id, event_type, payload::text AS payload FROM workflow.notification_outbox
                    WHERE entity_kind = 'EXECUTION' AND entity_id = ?
                    """, completedExecutionId);
            CorrelationData replay = new CorrelationData(completedOutbox.get("event_id").toString());
            rabbitTemplate.convertAndSend("weav.events", (String) completedOutbox.get("event_type"),
                    ((String) completedOutbox.get("payload")).getBytes(StandardCharsets.UTF_8), message -> {
                        message.getMessageProperties().setDeliveryMode(
                                org.springframework.amqp.core.MessageDeliveryMode.PERSISTENT);
                        message.getMessageProperties().setContentType("application/json");
                        return message;
                    }, replay);
            assertTrue(replay.getFuture().get(5, TimeUnit.SECONDS).ack());
            Thread.sleep(500);
            assertEquals(6, jdbc.queryForObject("""
                    SELECT count(*) FROM notification.notification_inbox WHERE workspace_id = ?
                    """, Integer.class, workspaceId), "replaying the same eventId must deduplicate");
            assertNull(rabbitTemplate.receive(RabbitExecutionConfiguration.EXECUTION_QUEUE, 100),
                    "notification events must not enter the execution-job queue");
        } finally {
            stopNotificationBridge(bridge);
        }
    }

    private List<String> eventTypes(UUID workflowId) {
        return jdbc.queryForList("""
                SELECT event_type FROM workflow.notification_outbox
                WHERE entity_kind = 'WORKFLOW' AND entity_id = ? ORDER BY sequence_id
                """, String.class, workflowId);
    }

    private TerminalFixture manualTerminalFixture(String name, UUID creatorId, UUID publisherId, UUID initiatorId) {
        UUID workspaceId = UUID.randomUUID();
        Workflow workflow = drafts.create(new CreateWorkflowCommand(workspaceId, creatorId, name, null));
        publications.publish(workspaceId, workflow.getId(), publisherId);
        ExecutionAdmissionPort.Admission admission = admissions.create(new ExecutionAdmissionPort.Command(
                workspaceId, workflow.getId(), initiatorId, null, ExecutionTriggerType.MANUAL,
                Map.of("private-input", "never-notify"), null, null, null));
        ExecutionStatePort.Lease lease = executions.claim(admission.executionId(), "terminal-notification-test",
                java.time.Duration.ofSeconds(30)).orElseThrow();
        return new TerminalFixture(creatorId, initiatorId, admission, lease, executions.load(lease));
    }

    private ExecutionStatePort.Transition terminalTransition(
            ExecutionStatePort.Snapshot snapshot, ExecutionStatus status, Instant finishedAt) {
        NodeExecutionStatus nodeStatus = switch (status) {
            case SUCCESS -> NodeExecutionStatus.SUCCESS;
            case FAILED -> NodeExecutionStatus.FAILED;
            case CANCELLED -> NodeExecutionStatus.CANCELLED;
            default -> NodeExecutionStatus.PENDING;
        };
        Map<String, NodeExecutionStatus> nodeStatuses = new LinkedHashMap<>();
        List<NodeExecution> nodes = new java.util.ArrayList<>();
        for (NodeExecution node : snapshot.nodes().values()) {
            nodes.add(new NodeExecution(node.getId(), node.getExecutionId(), node.getNodeId(), node.getNodeType(),
                    nodeStatus, node.getInput(), Map.of("private-provider-output", "never-notify"),
                    Map.of("private-error", "private-error-details"), 1, finishedAt, finishedAt,
                    node.getCreatedAt(), null));
            nodeStatuses.put(node.getNodeId(), nodeStatus);
        }
        return new ExecutionStatePort.Transition(new GraphState(nodeStatuses, snapshot.graph().edges()),
                nodes, snapshot.attempts(), Map.of(), status,
                Map.of("private-output", "never-notify"), Map.of("private-error", "private-error-details"),
                finishedAt, List.of());
    }

    private int notificationCount(UUID entityId) {
        return jdbc.queryForObject("SELECT count(*) FROM workflow.notification_outbox WHERE entity_id = ?",
                Integer.class, entityId);
    }

    private void changeStateTogether(UUID workspaceId, UUID workflowId, UUID actorId,
                                     CountDownLatch ready, CountDownLatch start) {
        ready.countDown();
        try {
            if (!start.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Concurrent pause start gate timed out");
            }
            publications.pause(workspaceId, workflowId, actorId);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Concurrent pause was interrupted", exception);
        }
    }

    private void publishTogether(CountDownLatch ready, CountDownLatch start) {
        ready.countDown();
        try {
            if (!start.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Concurrent publisher start gate timed out");
            }
            notificationPublisher.publishPending();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Concurrent notification publisher was interrupted", exception);
        }
    }

    private UUID runManualExecution(UUID workspaceId, UUID workflowId, UUID initiatorId, ExecutionStatus status) {
        ExecutionAdmissionPort.Admission admission = admissions.create(new ExecutionAdmissionPort.Command(
                workspaceId, workflowId, initiatorId, null, ExecutionTriggerType.MANUAL,
                Map.of("execution-input", "never-notify"), null, null, null));
        ExecutionStatePort.Lease lease = executions.claim(admission.executionId(), "compiled-notification-test",
                java.time.Duration.ofSeconds(30)).orElseThrow();
        ExecutionStatePort.Snapshot snapshot = executions.load(lease);
        assertTrue(executions.commit(lease, terminalTransition(snapshot, status, Instant.now())));
        return admission.executionId();
    }

    private void awaitInboxCount(UUID workspaceId, int expected, java.time.Duration timeout) throws Exception {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (System.nanoTime() < deadline) {
            Integer count = jdbc.queryForObject("""
                    SELECT count(*) FROM notification.notification_inbox WHERE workspace_id = ?
                    """, Integer.class, workspaceId);
            if (count != null && count == expected) {
                return;
            }
            Thread.sleep(100);
        }
        assertEquals(expected, jdbc.queryForObject("""
                SELECT count(*) FROM notification.notification_inbox WHERE workspace_id = ?
                """, Integer.class, workspaceId), "compiled consumer did not persist all six messages");
    }

    private List<Map<String, Object>> getInbox(NotificationRuntimeBridge bridge, String token) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(bridge.url() + "/api/v2/notifications?limit=50&locale=en"))
                .header("Authorization", "Bearer " + token)
                .GET()
                .build();
        HttpResponse<String> response = HttpClient.newHttpClient().send(request,
                HttpResponse.BodyHandlers.ofString());
        assertEquals(200, response.statusCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> result = objectMapper.readValue(response.body(), Map.class);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        return items;
    }

    private NotificationRuntimeBridge startNotificationBridge(UUID creatorId, UUID initiatorId) throws Exception {
        Path repository = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize()
                .getParent().getParent();
        Path script = repository.resolve("services/workspace-service/test/notification-runtime-bridge.cjs");
        ProcessBuilder processBuilder = new ProcessBuilder("node", script.toString()).redirectErrorStream(true);
        Map<String, String> childEnvironment = processBuilder.environment();
        childEnvironment.clear();
        copyEnvironment(childEnvironment, "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP");
        childEnvironment.put("NODE_PATH", repository.resolve("services/notification-service/node_modules").toString());
        childEnvironment.put("DB_HOST", postgresContainer.getHost());
        childEnvironment.put("DB_PORT", Integer.toString(postgresContainer.getMappedPort(5432)));
        childEnvironment.put("DB_NAME", postgresContainer.getDatabaseName());
        childEnvironment.put("DB_USERNAME", postgresContainer.getUsername());
        childEnvironment.put("DB_PASSWORD", postgresContainer.getPassword());
        childEnvironment.put("DB_SSL_MODE", "disable");
        childEnvironment.put("DB_SCHEMA", "notification");
        childEnvironment.put("RABBITMQ_HOST", rabbitContainer.getHost());
        childEnvironment.put("RABBITMQ_PORT", Integer.toString(rabbitContainer.getMappedPort(5672)));
        childEnvironment.put("RABBITMQ_USERNAME", rabbitContainer.getAdminUsername());
        childEnvironment.put("RABBITMQ_PASSWORD", rabbitContainer.getAdminPassword());
        childEnvironment.put("RABBITMQ_VHOST", "/");
        childEnvironment.put("RABBITMQ_TLS", "false");
        childEnvironment.put("JWT_ACCESS_SECRET", "workflow-test-access-secret-with-at-least-32-utf8-bytes");
        childEnvironment.put("JWT_ISSUER", "weav-identity");
        childEnvironment.put("JWT_AUDIENCE", "weav-api");
        childEnvironment.put("NOTIFICATION_TELEGRAM_ENABLED", "false");
        childEnvironment.put("NOTIFICATION_EXPO_ENABLED", "false");
        childEnvironment.put("TASK4_OWNER_ID", creatorId.toString());
        childEnvironment.put("TASK4_MEMBER_ID", initiatorId.toString());
        Process process = processBuilder.start();
        BlockingQueue<String> output = new LinkedBlockingQueue<>();
        Thread outputReader = new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                    process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.offer(line);
                }
            } catch (Exception ignored) {
                // The test checks readiness and exit state without echoing child output or credentials.
            }
        }, "task7-notification-bridge-output");
        outputReader.setDaemon(true);
        outputReader.start();
        long deadline = System.nanoTime() + java.time.Duration.ofSeconds(30).toNanos();
        String lastOutput = null;
        String bridgeFailure = null;
        List<String> startupDiagnostics = new java.util.ArrayList<>();
        while (System.nanoTime() < deadline) {
            String line = output.poll(100, TimeUnit.MILLISECONDS);
            if (line != null) {
                lastOutput = line;
                if (!line.startsWith("TASK4_READY:")) {
                    startupDiagnostics.add(line);
                    if (startupDiagnostics.size() > 12) {
                        startupDiagnostics.removeFirst();
                    }
                }
                if (line.startsWith("Task4 Notification test bridge failed at ")) {
                    bridgeFailure = line;
                }
            }
            if (line != null && line.startsWith("TASK4_READY:")) {
                @SuppressWarnings("unchecked")
                Map<String, Object> ready = objectMapper.readValue(line.substring("TASK4_READY:".length()), Map.class);
                return new NotificationRuntimeBridge(process, output, (String) ready.get("url"),
                        (String) ready.get("ownerToken"), (String) ready.get("memberToken"));
            }
            if (!process.isAlive()) {
                String diagnostic = bridgeFailure != null ? bridgeFailure
                        : lastOutput == null ? output.poll(1, TimeUnit.SECONDS) : lastOutput;
                throw new IllegalStateException("Compiled Notification bridge exited before readiness (exit "
                        + process.exitValue() + ")"
                        + (diagnostic == null ? "" : ": " + sanitizeBridgeDiagnostic(
                                bridgeFailure == null ? String.join(" | ", startupDiagnostics) : bridgeFailure)));
            }
        }
        stopNotificationBridge(new NotificationRuntimeBridge(process, output, null, null, null));
        throw new IllegalStateException("Compiled Notification bridge did not become ready in 30 seconds");
    }

    private void stopNotificationBridge(NotificationRuntimeBridge bridge) throws Exception {
        if (bridge == null || !bridge.process().isAlive()) {
            return;
        }
        bridge.process().getOutputStream().write("STOP\n".getBytes(StandardCharsets.UTF_8));
        bridge.process().getOutputStream().flush();
        if (!bridge.process().waitFor(15, TimeUnit.SECONDS)) {
            bridge.process().destroy();
            if (!bridge.process().waitFor(5, TimeUnit.SECONDS)) {
                bridge.process().destroyForcibly();
                bridge.process().waitFor(5, TimeUnit.SECONDS);
            }
        }
    }

    private void copyEnvironment(Map<String, String> target, String... names) {
        for (String name : names) {
            String value = System.getenv(name);
            if (value != null) {
                target.put(name, value);
            }
        }
    }

    private String sanitizeBridgeDiagnostic(String diagnostic) {
        return diagnostic.replaceAll("(?i)postgres(?:ql)?://\\S+", "[redacted-database-url]")
                .replaceAll("(?i)(password|token|secret|authorization)\\s*[:=]\\s*\\S+", "$1=[redacted]");
    }

    private record TerminalFixture(UUID creatorId, UUID initiatorId, ExecutionAdmissionPort.Admission admission,
                                   ExecutionStatePort.Lease lease, ExecutionStatePort.Snapshot snapshot) {
    }

    private record NotificationRuntimeBridge(Process process, BlockingQueue<String> output, String url,
                                             String creatorToken, String initiatorToken) {
    }
}
