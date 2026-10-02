package com.weav.workflow.presentation.http;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.infrastructure.messaging.ExecutionOutboxPublisher;
import com.weav.workflow.infrastructure.messaging.RabbitExecutionConfiguration;
import com.weav.workflow.infrastructure.web.WorkflowRequestBodyLimitFilter;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Exercises public webhook HTTP ingress against real PostgreSQL and RabbitMQ containers. */
@SpringBootTest(properties = {
        "weav.workflow.execution.worker.enabled=true",
        "weav.workflow.execution.worker.owner=task17-webhook-ingress",
        "weav.workflow.execution.worker.lease-duration=PT20S",
        "weav.workflow.execution.worker.heartbeat-interval=PT5S",
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
        "weav.workflow.schedule.scanner.enabled=false",
        "spring.rabbitmq.publisher-confirm-type=correlated",
        "spring.rabbitmq.publisher-returns=true",
        "spring.rabbitmq.template.mandatory=true"
})
@Import(WorkflowPublicationTestConfiguration.class)
class WebhookIngressTest {
    private static final String TEST_SECRET = "workflow-test-access-secret-with-at-least-32-utf8-bytes";
    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000071");
    private static final Set<String> CAPABILITIES = Set.of(
            "WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT", "WORKFLOW_PUBLISH",
            "WORKFLOW_RUN", "WORKFLOW_MANAGE_STATE", "WORKFLOW_MONITOR");

    @Autowired
    private WebApplicationContext webApplicationContext;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private WorkflowRepository workflows;
    @Autowired
    private WorkflowPublicationService publication;
    @Autowired
    private WorkflowPublicationTestConfiguration.PublicationWorkspaceAccess workspaceAccess;
    @Autowired
    private WorkflowRequestBodyLimitFilter bodyLimitFilter;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private ExecutionOutboxPublisher outboxPublisher;
    @Autowired
    private RabbitAdmin rabbitAdmin;

    private UUID workspaceId;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        workspaceId = UUID.randomUUID();
        workspaceAccess.setCapabilities(CAPABILITIES);
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.EXECUTION_QUEUE, false);
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.DEAD_LETTER_QUEUE, false);
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .addFilters(bodyLimitFilter)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
    }

    @AfterEach
    void tearDown() {
        workspaceAccess.reset();
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.EXECUTION_QUEUE, false);
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.DEAD_LETTER_QUEUE, false);
    }

    @Test
    void oneTimeCredentialsAuthenticateAndDurablyRunOnlyTheFiringRootAfterPause() throws Exception {
        PublishedWebhook webhook = createPublishedWebhook("Ingress acceptance");
        assertFalse(webhook.endpointKey().isBlank());
        assertFalse(webhook.secret().isBlank());

        Map<String, Object> stored = jdbc.queryForMap(
                "select * from workflow.workflow_triggers where id = ?", webhook.triggerId());
        assertEquals(webhook.endpointKey(), stored.get("endpoint_key"));
        assertEquals(sha256(webhook.secret()), stored.get("secret_hash"));
        assertNotEquals(webhook.secret(), stored.get("secret_hash"));
        assertFalse(stored.values().stream()
                .anyMatch(value -> value != null && value.toString().contains(webhook.secret())));

        String unknownKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        JsonNode unknown = requestWebhook(unknownKey, null, "{}");
        JsonNode missing = requestWebhook(webhook.endpointKey(), null, "{}");
        JsonNode wrong = requestWebhook(webhook.endpointKey(), "wrong-secret", "{}");
        assertEquals(404, unknown.path("status").intValue());
        assertEquals(unknown.path("error").path("code").stringValue(), missing.path("error").path("code").stringValue());
        assertEquals(unknown.path("error").path("code").stringValue(), wrong.path("error").path("code").stringValue());
        assertEquals(unknown.path("error").path("message").stringValue(), missing.path("error").path("message").stringValue());
        assertEquals(unknown.path("error").path("message").stringValue(), wrong.path("error").path("message").stringValue());
        assertEquals("/webhooks/{endpointKey}", unknown.path("path").stringValue());
        assertEquals("/webhooks/{endpointKey}", missing.path("path").stringValue());
        assertEquals("/webhooks/{endpointKey}", wrong.path("path").stringValue());

        MvcResult accepted = mockMvc.perform(post("/webhooks/" + webhook.endpointKey())
                        .header("X-Webhook-Secret", webhook.secret())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"event\":\"created\"}"))
                .andExpect(status().isAccepted())
                .andReturn();
        JsonNode body = objectMapper.readTree(accepted.getResponse().getContentAsString());
        UUID executionId = UUID.fromString(body.path("executionId").stringValue());
        assertEquals("QUEUED", body.path("status").stringValue());
        Map<String, Object> execution = jdbc.queryForMap(
                "select trigger_id, trigger_type, root_node_id, status, input::text as input_json "
                        + "from workflow.workflow_executions where id = ?", executionId);
        assertEquals(webhook.triggerId(), execution.get("trigger_id"));
        assertEquals("WEBHOOK", execution.get("trigger_type"));
        assertEquals("webhook", execution.get("root_node_id"));
        assertEquals("QUEUED", execution.get("status"));
        assertTrue(((String) execution.get("input_json")).contains("created"));
        assertEquals(1, count("select count(*) from workflow.outbox_events where aggregate_id = ?", executionId));

        mockMvc.perform(post(path(webhook.workflow(), "pause"))
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk());
        assertTrue(outboxPublisher.publishPending() >= 1);
        awaitSuccess(executionId);
        assertEquals("SUCCESS", executionStatus(executionId));
        assertEquals("SUCCESS", nodeStatus(executionId, "webhook"));
        assertEquals("SKIPPED", nodeStatus(executionId, "manual"));
        assertFalse(accepted.getResponse().getContentAsString().contains(webhook.secret()));
    }

    @Test
    void acceptsJsonNullAndArbitraryJsonValues() throws Exception {
        PublishedWebhook webhook = createPublishedWebhook("JSON input acceptance");

        UUID nullExecution = acceptedExecution(webhook, "null");
        UUID arrayExecution = acceptedExecution(webhook, "[1,true,{\"nested\":\"value\"}]");

        assertEquals("null", jdbc.queryForObject(
                "select input::text from workflow.workflow_executions where id = ?", String.class, nullExecution));
        assertEquals("[1, true, {\"nested\": \"value\"}]", jdbc.queryForObject(
                "select input::text from workflow.workflow_executions where id = ?", String.class, arrayExecution));
    }

    @Test
    void inactivePausedAndSupersededRegistrationsShareTheGenericNotFoundResponse() throws Exception {
        PublishedWebhook first = createPublishedWebhook("Lifecycle ingress");

        jdbc.update("update workflow.workflow_triggers set status = 'DISABLED' where id = ?", first.triggerId());
        JsonNode inactive = requestWebhook(first.endpointKey(), first.secret(), "{}");
        assertEquals("WEBHOOK_NOT_FOUND", inactive.path("error").path("code").stringValue());
        assertEquals("Webhook was not found", inactive.path("error").path("message").stringValue());
        jdbc.update("update workflow.workflow_triggers set status = 'ACTIVE' where id = ?", first.triggerId());

        mockMvc.perform(post(path(first.workflow(), "pause"))
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk());
        JsonNode paused = requestWebhook(first.endpointKey(), first.secret(), "{}");
        assertEquals("WEBHOOK_NOT_FOUND", paused.path("error").path("code").stringValue());
        assertEquals(inactive.path("error").path("message").stringValue(), paused.path("error").path("message").stringValue());
        assertEquals("/webhooks/{endpointKey}", paused.path("path").stringValue());

        mockMvc.perform(post(path(first.workflow(), "resume"))
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk());
        Workflow edited = workflows.findById(first.workflow().getId()).orElseThrow();
        edited.updateDraft(edited.getName(), edited.getDescription(), webhookDefinition("revision-2"), Map.of());
        workflows.save(edited);
        PublishedWebhook second = publishCurrent(edited);

        assertNotEquals(first.endpointKey(), second.endpointKey());
        JsonNode superseded = requestWebhook(first.endpointKey(), first.secret(), "{}");
        assertEquals("WEBHOOK_NOT_FOUND", superseded.path("error").path("code").stringValue());
        assertEquals("/webhooks/{endpointKey}", superseded.path("path").stringValue());
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.workflow_triggers where endpoint_key = ?", Integer.class,
                second.endpointKey()));
    }

    @Test
    void malformedAndOversizedBodiesFailBeforeDurableAdmissionAndRedactThePath() throws Exception {
        PublishedWebhook webhook = createPublishedWebhook("Bounded ingress");

        mockMvc.perform(post("/webhooks/" + webhook.endpointKey())
                        .header("X-Webhook-Secret", webhook.secret())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{malformed"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.path").value("/webhooks/{endpointKey}"));

        String oversized = "\"" + "x".repeat(WorkflowRequestBodyLimitFilter.MAX_REQUEST_BYTES + 1) + "\"";
        MvcResult tooLarge = mockMvc.perform(post("/webhooks/" + webhook.endpointKey())
                        .header("X-Webhook-Secret", webhook.secret())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(oversized))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.path").value("/webhooks/{endpointKey}"))
                .andReturn();
        assertFalse(tooLarge.getResponse().getContentAsString().contains(webhook.endpointKey()));
        assertFalse(tooLarge.getResponse().getContentAsString().contains(webhook.secret()));
        assertEquals(0, count("select count(*) from workflow.workflow_executions where workflow_id = ?",
                webhook.workflow().getId()));
    }

    @Test
    void outboxInsertFailureRollsBackExecutionAndReturnsNoAcceptedResponse() throws Exception {
        PublishedWebhook webhook = createPublishedWebhook("Outbox rollback");
        jdbc.execute("""
                CREATE OR REPLACE FUNCTION workflow.task17_reject_execution_outbox() RETURNS trigger
                LANGUAGE plpgsql AS $$
                BEGIN
                    IF NEW.aggregate_type = 'WORKFLOW_EXECUTION' AND NEW.event_type = 'EXECUTION_REQUESTED' THEN
                        RAISE EXCEPTION 'controlled webhook outbox failure';
                    END IF;
                    RETURN NEW;
                END;
                $$
                """);
        jdbc.execute("""
                CREATE TRIGGER task17_reject_execution_outbox
                BEFORE INSERT ON workflow.outbox_events
                FOR EACH ROW EXECUTE FUNCTION workflow.task17_reject_execution_outbox()
                """);
        try {
            MvcResult rejected = mockMvc.perform(post("/webhooks/" + webhook.endpointKey())
                            .header("X-Webhook-Secret", webhook.secret())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"rollback\":true}"))
                    .andReturn();

            assertEquals(500, rejected.getResponse().getStatus());
            assertEquals("/webhooks/{endpointKey}", objectMapper.readTree(rejected.getResponse().getContentAsString())
                    .path("path").stringValue());
            assertFalse(rejected.getResponse().getContentAsString().contains(webhook.endpointKey()));
            assertFalse(rejected.getResponse().getContentAsString().contains(webhook.secret()));
            assertEquals(0, count("select count(*) from workflow.workflow_executions where workflow_id = ?",
                    webhook.workflow().getId()));
            assertEquals(0, count("select count(*) from workflow.node_executions n "
                    + "join workflow.workflow_executions e on e.id = n.execution_id where e.workflow_id = ?",
                    webhook.workflow().getId()));
            assertEquals(0, count("select count(*) from workflow.outbox_events o "
                    + "where o.aggregate_id in (select id from workflow.workflow_executions where workflow_id = ?)",
                    webhook.workflow().getId()));
        } finally {
            jdbc.execute("DROP TRIGGER IF EXISTS task17_reject_execution_outbox ON workflow.outbox_events");
            jdbc.execute("DROP FUNCTION IF EXISTS workflow.task17_reject_execution_outbox()");
        }
    }

    private PublishedWebhook createPublishedWebhook(String name) throws Exception {
        Workflow workflow = workflows.save(Workflow.createDraft(workspaceId, name, "Description", USER_ID));
        workflow.updateDraft(workflow.getName(), workflow.getDescription(), webhookDefinition("revision-1"), Map.of());
        workflows.save(workflow);
        return publishCurrent(workflow);
    }

    private PublishedWebhook publishCurrent(Workflow workflow) throws Exception {
        MvcResult published = mockMvc.perform(post(path(workflow, "publish"))
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.webhooks.length()").value(1))
                .andReturn();
        JsonNode result = objectMapper.readTree(published.getResponse().getContentAsString());
        JsonNode provisioned = result.path("webhooks").get(0);
        return new PublishedWebhook(workflow, UUID.fromString(provisioned.path("triggerId").stringValue()),
                provisioned.path("endpointKey").stringValue(), provisioned.path("secret").stringValue());
    }

    private JsonNode requestWebhook(String endpointKey, String secret, String body) throws Exception {
        var builder = post("/webhooks/" + endpointKey)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
        if (secret != null) {
            builder.header("X-Webhook-Secret", secret);
        }
        MvcResult result = mockMvc.perform(builder)
                .andExpect(status().isNotFound())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    private UUID acceptedExecution(PublishedWebhook webhook, String body) throws Exception {
        MvcResult result = mockMvc.perform(post("/webhooks/" + webhook.endpointKey())
                        .header("X-Webhook-Secret", webhook.secret())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isAccepted())
                .andReturn();
        return UUID.fromString(objectMapper.readTree(result.getResponse().getContentAsString())
                .path("executionId").stringValue());
    }

    private Map<String, Object> webhookDefinition(String revision) {
        Map<String, Object> manual = Map.of("id", "manual", "type", "trigger.manual", "config", Map.of());
        Map<String, Object> webhook = Map.of("id", "webhook", "type", "trigger.webhook", "config", Map.of());
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("schemaVersion", "1.0");
        definition.put("nodes", List.of(manual, webhook));
        definition.put("edges", List.of());
        definition.put("variables", Map.of("revision", revision));
        return definition;
    }

    private String path(Workflow workflow, String operation) {
        return "/workspaces/" + workspaceId + "/workflows/" + workflow.getId() + "/" + operation;
    }

    private int count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Integer.class, args);
    }

    private String executionStatus(UUID executionId) {
        return jdbc.queryForObject("select status from workflow.workflow_executions where id = ?",
                String.class, executionId);
    }

    private String nodeStatus(UUID executionId, String nodeId) {
        return jdbc.queryForObject("select n.status from workflow.node_executions n "
                        + "where n.execution_id = ? and n.node_id = ?", String.class, executionId, nodeId);
    }

    private void awaitSuccess(UUID executionId) throws InterruptedException {
        long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(20);
        while (System.nanoTime() < deadline) {
            if ("SUCCESS".equals(executionStatus(executionId))) {
                return;
            }
            Thread.sleep(50);
        }
        assertEquals("SUCCESS", executionStatus(executionId), "Rabbit worker did not finish webhook execution");
    }

    private String sha256(String value) throws Exception {
        return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    private String accessToken(UUID subject) throws Exception {
        Instant now = Instant.now();
        Map<String, Object> header = Map.of("alg", "HS256", "typ", "JWT");
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("iss", "weav-identity");
        claims.put("sub", subject.toString());
        claims.put("aud", List.of("weav-api"));
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
        mac.init(new SecretKeySpec(TEST_SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return input + "." + Base64.getUrlEncoder().withoutPadding()
                .encodeToString(mac.doFinal(input.getBytes(StandardCharsets.UTF_8)));
    }

    private String encode(Object value) throws Exception {
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(objectMapper.writeValueAsBytes(value));
    }

    private record PublishedWebhook(Workflow workflow, UUID triggerId, String endpointKey, String secret) {
        @Override
        public String toString() {
            return "PublishedWebhook[workflowId=" + workflow.getId() + ", triggerId=" + triggerId
                    + ", endpointKey=<redacted>, secret=<redacted>]";
        }
    }
}
