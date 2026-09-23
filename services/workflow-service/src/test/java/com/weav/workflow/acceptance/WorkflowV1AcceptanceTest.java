package com.weav.workflow.acceptance;

import com.weav.workflow.WorkflowDraftTestConfiguration;
import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.infrastructure.messaging.ExecutionOutboxPublisher;
import com.weav.workflow.infrastructure.scheduling.WorkflowScheduleScanner;
import com.weav.workflow.infrastructure.security.JwtProperties;
import com.weav.workflow.infrastructure.web.CorrelationIdFilter;
import com.weav.workflow.infrastructure.messaging.ExecutionWorkerRabbitConfiguration;
import com.weav.workflow.infrastructure.messaging.RabbitExecutionConfiguration;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Real HTTP + PostgreSQL + RabbitMQ V1 acceptance across publication, trigger
 * roots, immutable versions, lifecycle changes, graph execution and usage.
 * Outbound HTTP is replaced only at the provider adapter boundary; the
 * persisted graph, admission, outbox, broker listener, runner and projections
 * are the production implementations.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "weav.workflow.execution.worker.enabled=true",
        "weav.workflow.execution.worker.owner=workflow-v1-acceptance",
        "weav.workflow.execution.worker.lease-duration=PT20S",
        "weav.workflow.execution.worker.heartbeat-interval=PT10S",
        "weav.workflow.execution.worker.max-transient-redeliveries=3",
        "weav.workflow.execution.recovery.initial-delay=3600000",
        "weav.workflow.execution.recovery.poll-interval=3600000",
        "weav.workflow.execution.recovery.batch-size=20",
        "weav.workflow.execution.recovery.queued-delivery-age=PT1M",
        "weav.workflow.execution.recovery.outbox-cooldown=PT1M",
        "weav.workflow.execution.max-concurrent-nodes=2",
        "weav.workflow.execution.executor-threads=4",
        "weav.workflow.execution.executor-queue-size=16",
        "weav.workflow.execution.timer-threads=2",
        "weav.workflow.http.executor.enabled=false",
        "weav.workflow.execution-outbox.initial-delay=3600000",
        "weav.workflow.execution-outbox.poll-interval=3600000",
        "weav.workflow.schedule.scanner.enabled=true",
        "weav.workflow.schedule.scanner.initial-delay-ms=3600000",
        "weav.workflow.schedule.scanner.poll-interval-ms=3600000",
        "weav.workflow.schedule.scanner.batch-size=20",
        "spring.rabbitmq.publisher-confirm-type=correlated",
        "spring.rabbitmq.publisher-returns=true",
        "spring.rabbitmq.template.mandatory=true"
})
@Import({WorkflowDraftTestConfiguration.class, WorkflowV1AcceptanceTest.AcceptanceRuntime.class})
class WorkflowV1AcceptanceTest {

    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000071");
    private static final Set<String> FULL_CAPABILITIES = Set.of(
            "WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT", "WORKFLOW_PUBLISH",
            "WORKFLOW_MANAGE_STATE", "WORKFLOW_RUN", "WORKFLOW_MONITOR");
    private static final String INTERNAL_KEY = "workflow-test-internal-service-key";
    private static final String WRONG_SECRET_MARKER = "workflow-v1-invalid-secret-marker-7ef17b";
    private static final String CONNECTION_FIXTURE_ID = "__WORKFLOW_TEST_GOOGLE_SHEETS_CONNECTION_ID__";
    private static final String SPREADSHEET_FIXTURE_ID = "__WORKFLOW_TEST_GOOGLE_SHEETS_SPREADSHEET_ID__";

    @Value("${local.server.port}")
    private int port;

    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private JwtProperties jwtProperties;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private WorkflowDraftTestConfiguration.DraftWorkspaceBoundary workspaceBoundary;
    @Autowired
    private ExecutionOutboxPublisher outboxPublisher;
    @Autowired
    private WorkflowScheduleScanner scheduleScanner;
    @Autowired
    private RabbitAdmin rabbitAdmin;
    @Autowired
    private AcceptanceHttpExecutor httpExecutor;

    private final HttpClient http = HttpClient.newHttpClient();

    @BeforeEach
    void setUp() {
        workspaceBoundary.reset();
        workspaceBoundary.setCapabilities(FULL_CAPABILITIES);
        httpExecutor.reset();
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.EXECUTION_QUEUE, false);
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.DEAD_LETTER_QUEUE, false);
        rabbitAdmin.purgeQueue(ExecutionWorkerRabbitConfiguration.RETRY_QUEUE, false);
    }

    @AfterEach
    void tearDown() {
        httpExecutor.releaseBlockedNodes();
        workspaceBoundary.reset();
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.EXECUTION_QUEUE, false);
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.DEAD_LETTER_QUEUE, false);
        rabbitAdmin.purgeQueue(ExecutionWorkerRabbitConfiguration.RETRY_QUEUE, false);
    }

    @Test
    void realHttpLifecyclePinsQueuedRunsAndExecutesManualWebhookScheduleRootsSafely() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        String token = accessToken(USER_ID);
        URI collection = uri("/workspaces/" + workspaceId + "/workflows");
        JsonNode fixture = manualHttpFixture();
        setConditionRight(fixture, true);

        HttpResponse<String> created = request("POST", collection, token,
                json(Map.of("name", "Workflow V1 acceptance", "description", "Disposable test fixture")), Map.of());
        assertEquals(201, created.statusCode());
        JsonNode createdJson = read(created);
        assertEquals("DRAFT", createdJson.path("status").stringValue());
        UUID workflowId = UUID.fromString(createdJson.path("workflowId").stringValue());
        URI workflow = uri("/workspaces/" + workspaceId + "/workflows/" + workflowId);

        HttpResponse<String> savedV1 = saveDraft(workflow, token, "Workflow V1 acceptance", fixture);
        assertEquals(200, savedV1.statusCode());
        assertEquals("DRAFT", read(savedV1).path("status").stringValue());
        assertEquals(200, request("GET", workflow, token, null, Map.of()).statusCode());
        JsonNode list = read(request("GET", collection, token, null, Map.of()));
        assertTrue(containsWorkflow(list.path("items"), workflowId));
        assertEquals(404, request("GET", uri("/workspaces/" + UUID.randomUUID()
                + "/workflows/" + workflowId), token, null, Map.of()).statusCode(),
                "a workflow must not be visible through another workspace path");

        HttpResponse<String> publishedV1 = request("POST", child(workflow, "/publish"), token, null, Map.of());
        assertEquals(200, publishedV1.statusCode());
        assertEquals("no-store", publishedV1.headers().firstValue("Cache-Control").orElse(null));
        JsonNode publicationV1 = read(publishedV1);
        UUID versionV1 = UUID.fromString(publicationV1.path("versionId").stringValue());
        JsonNode webhookV1 = publicationV1.path("webhooks").get(0);
        String endpointV1 = webhookV1.path("endpointKey").stringValue();
        String secretV1 = webhookV1.path("secret").stringValue();
        assertFalse(endpointV1.isBlank());
        assertFalse(secretV1.isBlank());
        assertEquals(2, count("select count(*) from workflow.workflow_triggers where workflow_id = ? and status = 'ACTIVE'",
                workflowId));
        String storedHash = scalar("select secret_hash from workflow.workflow_triggers where id = ?",
                UUID.fromString(webhookV1.path("triggerId").stringValue()));
        assertEquals(64, storedHash.length(), "only the fixed-length SHA-256 verifier is stored");
        assertNotEquals(secretV1, storedHash);
        JsonNode laterRead = read(request("GET", workflow, token, null, Map.of()));
        assertFalse(laterRead.toString().contains(secretV1));
        assertFalse(laterRead.toString().contains(endpointV1));

        int initialExecutions = count("select count(*) from workflow.workflow_executions where workflow_id = ?", workflowId);
        HttpResponse<String> wrongWebhook = request("POST", uri("/webhooks/" + endpointV1), null,
                "{\"marker\":\"accepted-only-if-secret-matches\"}",
                Map.of("X-Webhook-Secret", WRONG_SECRET_MARKER, "Content-Type", "application/json"));
        assertEquals(404, wrongWebhook.statusCode());
        assertFalse(wrongWebhook.body().contains(WRONG_SECRET_MARKER));
        assertFalse(wrongWebhook.body().contains(endpointV1));
        assertFalse(wrongWebhook.body().contains(secretV1));
        assertEquals(initialExecutions, count("select count(*) from workflow.workflow_executions where workflow_id = ?",
                workflowId));

        String correlationId = "workflow-v1-acceptance-" + UUID.randomUUID();
        HttpResponse<String> admittedV1 = request("POST", child(workflow, "/executions"), token,
                "{\"input\":{\"acceptance\":true}}",
                Map.of("Content-Type", "application/json", CorrelationIdFilter.HEADER_NAME, correlationId));
        assertEquals(202, admittedV1.statusCode());
        assertEquals(correlationId, admittedV1.headers().firstValue(CorrelationIdFilter.HEADER_NAME).orElse(null));
        JsonNode acceptedV1 = read(admittedV1);
        UUID executionV1 = UUID.fromString(acceptedV1.path("executionId").stringValue());
        assertEquals(versionV1.toString(), acceptedV1.path("workflowVersionId").stringValue());
        assertEquals("QUEUED", acceptedV1.path("status").stringValue());

        // Publish v2 while v1 is still queued. The accepted execution retains its immutable version.
        setConditionRight(fixture, false);
        assertEquals(200, saveDraft(workflow, token, "Workflow V1 acceptance v2", fixture).statusCode());
        HttpResponse<String> publishedV2 = request("POST", child(workflow, "/publish"), token, null, Map.of());
        assertEquals(200, publishedV2.statusCode());
        assertEquals("no-store", publishedV2.headers().firstValue("Cache-Control").orElse(null));
        JsonNode publicationV2 = read(publishedV2);
        UUID versionV2 = UUID.fromString(publicationV2.path("versionId").stringValue());
        String endpointV2 = publicationV2.path("webhooks").get(0).path("endpointKey").stringValue();
        String secretV2 = publicationV2.path("webhooks").get(0).path("secret").stringValue();
        assertNotEquals(versionV1, versionV2);
        assertEquals(versionV1, jdbc.queryForObject(
                "select workflow_version_id from workflow.workflow_executions where id = ?", UUID.class, executionV1));
        assertEquals(404, request("POST", uri("/webhooks/" + endpointV1), null, "{}",
                Map.of("X-Webhook-Secret", secretV1, "Content-Type", "application/json")).statusCode(),
                "republishing must retire the previous webhook registration");

        assertEquals(200, request("POST", child(workflow, "/pause"), token, null, Map.of()).statusCode());
        assertEquals("PAUSED", read(request("GET", workflow, token, null, Map.of())).path("status").stringValue());
        assertEquals(422, request("POST", child(workflow, "/executions"), token,
                "{\"input\":{}}", Map.of("Content-Type", "application/json")).statusCode());
        assertEquals(404, request("POST", uri("/webhooks/" + endpointV2), null, "{}",
                Map.of("X-Webhook-Secret", secretV2, "Content-Type", "application/json")).statusCode());
        jdbc.update("update workflow.workflow_triggers set next_run_at = current_timestamp - interval '5 seconds' "
                + "where workflow_id = ? and workflow_version_id = ? and type = 'SCHEDULE'", workflowId, versionV2);
        int beforePausedSchedule = count("select count(*) from workflow.workflow_executions where workflow_id = ?", workflowId);
        scheduleScanner.scan();
        assertEquals(beforePausedSchedule, count("select count(*) from workflow.workflow_executions where workflow_id = ?",
                workflowId), "a disabled schedule must not admit work while paused");

        httpExecutor.blockNodes("left-http", "right-http");
        assertTrue(outboxPublisher.publishPending() >= 1);
        assertTrue(httpExecutor.awaitBlockedNodes(15, TimeUnit.SECONDS),
                "the RabbitMQ consumer should execute both persisted HTTP branches");
        assertEquals("RUNNING", scalar("select status from workflow.workflow_executions where id = ?", executionV1));
        httpExecutor.releaseBlockedNodes();
        JsonNode completedV1 = awaitExecution(workflow, token, executionV1, "SUCCESS");
        assertEquals(versionV1.toString(), completedV1.path("workflowVersionId").stringValue());
        assertNode(completedV1, "condition", "SUCCESS", 1);
        assertNode(completedV1, "left-http", "SUCCESS", 1);
        assertNode(completedV1, "right-http", "SUCCESS", 1);
        assertNode(completedV1, "inactive-branch", "SKIPPED", 0);
        assertNode(completedV1, "join-http", "SUCCESS", 1);
        assertEquals("left-http", httpExecutor.output("left-http"));
        assertEquals("right-http", httpExecutor.output("right-http"));
        @SuppressWarnings("unchecked")
        Map<String, Object> joinInput = (Map<String, Object>) httpExecutor.input("join-http").get("body");
        assertEquals("left-http", joinInput.get("left"));
        assertEquals("right-http", joinInput.get("right"));

        assertEquals(200, request("POST", child(workflow, "/resume"), token, null, Map.of()).statusCode());
        JsonNode resumed = read(request("GET", workflow, token, null, Map.of()));
        assertEquals("PUBLISHED", resumed.path("status").stringValue());
        assertEquals(versionV2.toString(), resumed.path("currentVersionId").stringValue());

        HttpResponse<String> admittedV2 = request("POST", child(workflow, "/executions"), token,
                "{\"input\":{\"acceptance\":\"manual-v2\"}}", Map.of("Content-Type", "application/json"));
        assertEquals(202, admittedV2.statusCode());
        UUID manualV2 = UUID.fromString(read(admittedV2).path("executionId").stringValue());
        assertEquals(versionV2.toString(), read(admittedV2).path("workflowVersionId").stringValue());

        HttpResponse<String> webhookV2 = request("POST", uri("/webhooks/" + endpointV2), null,
                "{\"acceptance\":\"webhook-v2\"}",
                Map.of("X-Webhook-Secret", secretV2, "Content-Type", "application/json"));
        assertEquals(202, webhookV2.statusCode());
        UUID webhookExecutionV2 = UUID.fromString(read(webhookV2).path("executionId").stringValue());
        assertEquals(versionV2.toString(), read(webhookV2).path("workflowVersionId").stringValue());

        jdbc.update("update workflow.workflow_triggers set next_run_at = current_timestamp - interval '5 seconds' "
                + "where workflow_id = ? and workflow_version_id = ? and type = 'SCHEDULE'", workflowId, versionV2);
        scheduleScanner.scan();
        UUID scheduleExecutionV2 = jdbc.queryForObject(
                "select id from workflow.workflow_executions where workflow_id = ? and workflow_version_id = ? "
                        + "and trigger_type = 'SCHEDULE' order by created_at desc limit 1",
                UUID.class, workflowId, versionV2);
        assertNotNull(scheduleExecutionV2);
        assertEquals(versionV2, jdbc.queryForObject(
                "select workflow_version_id from workflow.workflow_executions where id = ?", UUID.class,
                scheduleExecutionV2));

        assertTrue(outboxPublisher.publishPending() >= 3);
        JsonNode manualV2Detail = awaitExecution(workflow, token, manualV2, "SUCCESS");
        JsonNode webhookV2Detail = awaitExecution(workflow, token, webhookExecutionV2, "SUCCESS");
        JsonNode scheduleV2Detail = awaitExecution(workflow, token, scheduleExecutionV2, "SUCCESS");
        for (JsonNode detail : List.of(manualV2Detail, webhookV2Detail, scheduleV2Detail)) {
            assertEquals(versionV2.toString(), detail.path("workflowVersionId").stringValue());
            assertNode(detail, "condition", "SUCCESS", 1);
            assertNode(detail, "inactive-branch", "SUCCESS", 1);
            assertNode(detail, "left-http", "SKIPPED", 0);
            assertNode(detail, "right-http", "SKIPPED", 0);
            assertNode(detail, "join-http", "SKIPPED", 0);
        }

        String sensitiveMarker = secretV1 + WRONG_SECRET_MARKER + secretV2;
        String databaseRows = workflowSensitiveRows(workflowId);
        assertFalse(databaseRows.contains(secretV1));
        assertFalse(databaseRows.contains(secretV2));
        assertFalse(databaseRows.contains(WRONG_SECRET_MARKER));
        assertFalse(databaseRows.contains(sensitiveMarker));

        HttpResponse<String> health = request("GET", uri("/actuator/health"), null, null, Map.of());
        assertEquals(200, health.statusCode());
        assertFalse(health.body().contains(INTERNAL_KEY), "health details must not reveal service keys");
        HttpResponse<String> readiness = request("GET", uri("/actuator/health/readiness"), null, null, Map.of());
        HttpResponse<String> liveness = request("GET", uri("/actuator/health/liveness"), null, null, Map.of());
        assertEquals(200, readiness.statusCode());
        assertEquals(200, liveness.statusCode());
        assertFalse(readiness.body().contains("components"));
        assertFalse(readiness.body().contains(INTERNAL_KEY));
        assertFalse(liveness.body().contains("components"));
        assertFalse(liveness.body().contains(INTERNAL_KEY));

        workspaceBoundary.setCapabilities(Set.of("WORKSPACE_VIEW"));
        int executionsBeforeDeniedRun = count("select count(*) from workflow.workflow_executions where workflow_id = ?",
                workflowId);
        HttpResponse<String> deniedRun = request("POST", child(workflow, "/executions"), token,
                "{\"input\":{}}", Map.of("Content-Type", "application/json"));
        assertEquals(403, deniedRun.statusCode());
        assertEquals(executionsBeforeDeniedRun,
                count("select count(*) from workflow.workflow_executions where workflow_id = ?", workflowId));
    }

    @Test
    void connectionUsageCountsLiveDraftsAndEveryImmutableVersionOverRealInternalHttp() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID connectionId = UUID.randomUUID();
        String token = accessToken(USER_ID);
        URI collection = uri("/workspaces/" + workspaceId + "/workflows");
        JsonNode sheetDefinition = googleSheetsFixture(connectionId, UUID.randomUUID());
        JsonNode noReferenceDefinition = manualHttpFixture();

        JsonNode created = read(request("POST", collection, token,
                json(Map.of("name", "Connection usage acceptance", "description", "Disposable fixture")), Map.of()));
        UUID workflowId = UUID.fromString(created.path("workflowId").stringValue());
        URI workflow = uri("/workspaces/" + workspaceId + "/workflows/" + workflowId);
        assertEquals(200, saveDraft(workflow, token, "Connection usage acceptance", sheetDefinition).statusCode());
        assertTrue(usage(workspaceId, connectionId));

        assertEquals(200, saveDraft(workflow, token, "Connection usage acceptance", noReferenceDefinition).statusCode());
        assertFalse(usage(workspaceId, connectionId), "removing the live draft reference should free an unpublished connection");
        assertEquals(200, saveDraft(workflow, token, "Connection usage acceptance", sheetDefinition).statusCode());
        JsonNode v1 = read(request("POST", child(workflow, "/publish"), token, null, Map.of()));
        assertTrue(usage(workspaceId, connectionId));

        assertEquals(200, saveDraft(workflow, token, "Connection usage acceptance v2", noReferenceDefinition).statusCode());
        JsonNode v2 = read(request("POST", child(workflow, "/publish"), token, null, Map.of()));
        assertNotEquals(v1.path("versionId").stringValue(), v2.path("versionId").stringValue());
        assertTrue(usage(workspaceId, connectionId), "an immutable published version keeps its connection reference in use");
        assertFalse(usage(workspaceId, UUID.randomUUID()), "a connection absent from drafts and versions is not in use");
        assertFalse(usage(UUID.randomUUID(), connectionId), "references are scoped to the owning workspace");
    }

    @Test
    void unconfiguredDependencyFixtureFailsClosedWithOnePersistedAttempt() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        String token = accessToken(USER_ID);
        URI collection = uri("/workspaces/" + workspaceId + "/workflows");
        JsonNode fixture = objectMapper.readTree(Files.readString(Path.of(
                "../../packages/contracts/http/workflow/examples/manual-unconfigured-dependency.json")));
        JsonNode created = read(request("POST", collection, token,
                json(Map.of("name", "Workflow dependency failure acceptance", "description", "Disposable fixture")), Map.of()));
        UUID workflowId = UUID.fromString(created.path("workflowId").stringValue());
        URI workflow = uri("/workspaces/" + workspaceId + "/workflows/" + workflowId);
        assertEquals(200, saveDraft(workflow, token, "Workflow dependency failure acceptance", fixture).statusCode());
        JsonNode publication = read(request("POST", child(workflow, "/publish"), token, null, Map.of()));
        assertNotNull(publication.path("versionId"));
        HttpResponse<String> admitted = request("POST", child(workflow, "/executions"), token,
                "{\"input\":{\"acceptance\":true}}", Map.of("Content-Type", "application/json"));
        assertEquals(202, admitted.statusCode());
        UUID executionId = UUID.fromString(read(admitted).path("executionId").stringValue());
        assertTrue(outboxPublisher.publishPending() >= 1);
        JsonNode detail = awaitExecution(workflow, token, executionId, "FAILED");
        assertNode(detail, "email", "FAILED", 1);
        assertEquals("DEPENDENCY_NOT_CONFIGURED", jdbc.queryForObject(
                "select a.error ->> 'code' from workflow.node_execution_attempts a "
                        + "join workflow.node_executions n on n.id = a.node_execution_id "
                        + "where n.execution_id = ? and n.node_id = 'email'",
                String.class, executionId));
    }

    private boolean usage(UUID workspaceId, UUID connectionId) throws Exception {
        HttpResponse<String> response = request("GET", uri("/internal/workspaces/" + workspaceId
                        + "/connections/" + connectionId + "/usage"), null, null,
                Map.of("X-Internal-Service-Key", INTERNAL_KEY));
        assertEquals(200, response.statusCode());
        return read(response).path("inUse").booleanValue();
    }

    private JsonNode googleSheetsFixture(UUID connectionId, UUID spreadsheetId) throws Exception {
        JsonNode fixture = objectMapper.readTree(Files.readString(Path.of(
                "../../packages/contracts/http/workflow/examples/google-sheets-read.template.json")));
        for (JsonNode node : fixture.path("nodes")) {
            if ("read-sheet".equals(node.path("id").stringValue())) {
                ObjectNode config = (ObjectNode) node.path("config");
                config.put("connectionId", connectionId.toString());
                config.put("spreadsheetId", spreadsheetId.toString());
            }
        }
        return fixture;
    }

    private JsonNode manualHttpFixture() throws Exception {
        return objectMapper.readTree(Files.readString(Path.of(
                "../../packages/contracts/http/workflow/examples/manual-http-condition.json")));
    }

    private void setConditionRight(JsonNode definition, boolean value) {
        for (JsonNode node : definition.path("nodes")) {
            if ("condition".equals(node.path("id").stringValue())) {
                ((ObjectNode) node.path("config")).put("right", value);
                return;
            }
        }
        throw new AssertionError("Acceptance graph is missing its condition node");
    }

    private HttpResponse<String> saveDraft(URI workflow, String token, String name, JsonNode definition) throws Exception {
        String body = json(Map.of("name", name, "description", "Persisted V1 acceptance fixture",
                "definition", definition, "editorState", Map.of()));
        return request("PUT", child(workflow, "/draft"), token, body, Map.of("Content-Type", "application/json"));
    }

    private JsonNode awaitExecution(URI workflow, String token, UUID executionId, String expectedStatus) throws Exception {
        URI detailUri = child(workflow, "/executions/" + executionId);
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(40);
        JsonNode detail = null;
        while (System.nanoTime() < deadline) {
            HttpResponse<String> response = request("GET", detailUri, token, null, Map.of());
            assertEquals(200, response.statusCode());
            detail = read(response);
            String status = detail.path("status").stringValue();
            if (expectedStatus.equals(status) || "FAILED".equals(status) || "CANCELLED".equals(status)) {
                assertEquals(expectedStatus, status);
                return detail;
            }
            Thread.sleep(100);
        }
        assertNotNull(detail);
        assertEquals(expectedStatus, detail.path("status").stringValue());
        return detail;
    }

    private void assertNode(JsonNode detail, String nodeId, String status, int attempts) {
        JsonNode found = null;
        for (JsonNode node : detail.path("nodes")) {
            if (nodeId.equals(node.path("nodeId").stringValue())) {
                found = node;
                break;
            }
        }
        assertNotNull(found, "execution detail should contain node " + nodeId);
        assertEquals(status, found.path("status").stringValue(), "node " + nodeId);
        assertEquals(attempts, found.path("attemptCount").intValue(), "attempt count for " + nodeId);
        assertEquals(attempts, found.path("attempts").size(), "attempt projection for " + nodeId);
    }

    private String workflowSensitiveRows(UUID workflowId) {
        return jdbc.queryForObject("select "
                        + "coalesce((select string_agg(to_jsonb(t)::text, ' ') from workflow.workflow_triggers t where t.workflow_id = ?), '') || ' ' || "
                        + "coalesce((select string_agg(to_jsonb(e)::text, ' ') from workflow.workflow_executions e where e.workflow_id = ?), '') || ' ' || "
                        + "coalesce((select string_agg(to_jsonb(o)::text, ' ') from workflow.outbox_events o "
                        + "where o.aggregate_id in (select e.id from workflow.workflow_executions e where e.workflow_id = ?)), '') || ' ' || "
                        + "coalesce((select string_agg(to_jsonb(n)::text, ' ') from workflow.node_executions n "
                        + "join workflow.workflow_executions e on e.id = n.execution_id where e.workflow_id = ?), '') || ' ' || "
                        + "coalesce((select string_agg(to_jsonb(a)::text, ' ') from workflow.node_execution_attempts a "
                        + "join workflow.node_executions n on n.id = a.node_execution_id "
                        + "join workflow.workflow_executions e on e.id = n.execution_id where e.workflow_id = ?), '') || ' ' || "
                        + "coalesce((select string_agg(to_jsonb(l)::text, ' ') from workflow.execution_logs l "
                        + "join workflow.workflow_executions e on e.id = l.execution_id where e.workflow_id = ?), '')",
                String.class, workflowId, workflowId, workflowId, workflowId, workflowId, workflowId);
    }

    private int count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Integer.class, args);
    }

    private String scalar(String sql, Object... args) {
        return jdbc.queryForObject(sql, String.class, args);
    }

    private boolean containsWorkflow(JsonNode items, UUID workflowId) {
        for (JsonNode item : items) {
            if (workflowId.toString().equals(item.path("workflowId").stringValue())) {
                return true;
            }
        }
        return false;
    }

    private HttpResponse<String> request(String method, URI uri, String token, String body,
                                         Map<String, String> headers) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri).timeout(java.time.Duration.ofSeconds(30));
        if (token != null) {
            builder.header("Authorization", "Bearer " + token);
        }
        if (body != null && headers.keySet().stream().noneMatch(key -> "Content-Type".equalsIgnoreCase(key))) {
            builder.header("Content-Type", "application/json");
        }
        headers.forEach(builder::header);
        if (body == null) {
            builder.method(method, HttpRequest.BodyPublishers.noBody());
        } else {
            builder.method(method, HttpRequest.BodyPublishers.ofString(body));
        }
        return http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    private JsonNode read(HttpResponse<String> response) throws Exception {
        return objectMapper.readTree(response.body());
    }

    private String json(Object value) throws Exception {
        return objectMapper.writeValueAsString(value);
    }

    private URI uri(String path) {
        return URI.create("http://localhost:" + port + path);
    }

    private URI child(URI base, String suffix) {
        return URI.create(base + suffix);
    }

    private String accessToken(UUID subject) throws Exception {
        Instant now = Instant.now();
        Map<String, Object> header = Map.of("alg", "HS256", "typ", "JWT");
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("iss", jwtProperties.issuer());
        claims.put("sub", subject.toString());
        claims.put("aud", List.of(jwtProperties.audience()));
        claims.put("iat", now.getEpochSecond());
        claims.put("nbf", now.getEpochSecond());
        claims.put("exp", now.plusSeconds(300).getEpochSecond());
        claims.put("jti", UUID.randomUUID().toString());
        claims.put("sid", UUID.randomUUID().toString());
        claims.put("system_role", "USER");
        claims.put("user_status", "ACTIVE");
        claims.put("token_use", "access");
        String input = encode(header) + "." + encode(claims);
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(jwtProperties.accessSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return input + "." + Base64.getUrlEncoder().withoutPadding()
                .encodeToString(mac.doFinal(input.getBytes(StandardCharsets.UTF_8)));
    }

    private String encode(Object value) throws Exception {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(objectMapper.writeValueAsBytes(value));
    }

    @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods = false)
    static class AcceptanceRuntime {
        @Bean
        AcceptanceHttpExecutor acceptanceHttpExecutor() {
            return new AcceptanceHttpExecutor();
        }
    }

    static final class AcceptanceHttpExecutor implements NodeExecutor {
        private final Map<String, AtomicInteger> calls = new java.util.concurrent.ConcurrentHashMap<>();
        private final Map<String, Map<String, Object>> inputs = new java.util.concurrent.ConcurrentHashMap<>();
        private volatile Set<String> blockedNodeIds = Set.of();
        private volatile CountDownLatch blockedEntered = new CountDownLatch(0);
        private volatile CountDownLatch blockedRelease = new CountDownLatch(0);

        @Override
        public String type() {
            return "http.request";
        }

        @Override
        public Result execute(Context context, Map<String, Object> resolvedConfig) {
            calls.computeIfAbsent(context.nodeId(), ignored -> new AtomicInteger()).incrementAndGet();
            inputs.put(context.nodeId(), resolvedConfig);
            if (blockedNodeIds.contains(context.nodeId())) {
                blockedEntered.countDown();
                try {
                    if (!blockedRelease.await(20, TimeUnit.SECONDS)) {
                        throw new Failure("TIMEOUT", "Acceptance executor gate timed out.", true);
                    }
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new Failure("WORKER_INTERRUPTED", "Acceptance executor gate was interrupted.", true);
                }
            }
            return new Result(Map.of("value", context.nodeId()), null);
        }

        boolean awaitBlockedNodes(long timeout, TimeUnit unit) throws InterruptedException {
            return blockedEntered.await(timeout, unit);
        }

        void blockNodes(String... ids) {
            blockedNodeIds = Set.of(ids);
            blockedEntered = new CountDownLatch(ids.length);
            blockedRelease = new CountDownLatch(1);
        }

        void releaseBlockedNodes() {
            blockedNodeIds = Set.of();
            blockedRelease.countDown();
        }

        String output(String nodeId) {
            return calls.containsKey(nodeId) && calls.get(nodeId).get() > 0 ? nodeId : null;
        }

        Map<String, Object> input(String nodeId) {
            return inputs.get(nodeId);
        }

        void reset() {
            releaseBlockedNodes();
            calls.clear();
            inputs.clear();
            blockedEntered = new CountDownLatch(0);
            blockedRelease = new CountDownLatch(0);
        }
    }
}
