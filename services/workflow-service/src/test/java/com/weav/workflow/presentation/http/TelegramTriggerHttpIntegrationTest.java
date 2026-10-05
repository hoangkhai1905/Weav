package com.weav.workflow.presentation.http;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.port.out.TelegramWebhookPort;
import com.weav.workflow.application.service.TelegramTriggerException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.infrastructure.web.WorkflowRequestBodyLimitFilter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.ObjectMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Publishes trigger.telegram workflows against real PostgreSQL with a recording Telegram port and drives the
 * public ingress: registration, secret check, idempotency, one bot per active workflow, pause and resume.
 */
@SpringBootTest(properties = "weav.workflow.public-base-url=https://weav.example.test")
@Import({WorkflowPublicationTestConfiguration.class, TelegramTriggerHttpIntegrationTest.FakeTelegramConfig.class})
class TelegramTriggerHttpIntegrationTest {

    private static final String TEST_SECRET = "workflow-test-access-secret-with-at-least-32-utf8-bytes";
    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000071");

    @TestConfiguration
    static class FakeTelegramConfig {
        @Bean
        @Primary
        RecordingTelegram recordingTelegram() {
            return new RecordingTelegram();
        }
    }

    static final class RecordingTelegram implements TelegramWebhookPort {
        final List<String[]> registered = new CopyOnWriteArrayList<>();
        final List<UUID> unregistered = new CopyOnWriteArrayList<>();
        volatile boolean fail;
        volatile long delayMillis;

        @Override
        public String publicBaseUrl() {
            return "https://weav.example.test";
        }

        @Override
        public void register(UUID workspaceId, UUID connectionId, String webhookUrl, String secretToken) {
            if (fail) {
                throw new TelegramTriggerException(TelegramTriggerException.REGISTRATION_FAILED,
                        "The Telegram webhook could not be registered: Telegram rejected the request.");
            }
            if (delayMillis > 0) {
                try {
                    Thread.sleep(delayMillis);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            }
            registered.add(new String[] {connectionId.toString(), webhookUrl, secretToken});
        }

        @Override
        public void unregister(UUID workspaceId, UUID connectionId) {
            unregistered.add(connectionId);
        }
    }

    @Autowired
    private WebApplicationContext webApplicationContext;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private WorkflowRepository workflows;
    @Autowired
    private WorkflowPublicationTestConfiguration.PublicationWorkspaceAccess workspaceAccess;
    @Autowired
    private WorkflowRequestBodyLimitFilter bodyLimitFilter;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private RecordingTelegram telegram;

    private UUID workspaceId;
    private UUID bot;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        workspaceId = UUID.randomUUID();
        bot = UUID.randomUUID();
        workspaceAccess.reset();
        telegram.registered.clear();
        telegram.unregistered.clear();
        telegram.fail = false;
        telegram.delayMillis = 0;
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .addFilters(bodyLimitFilter)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
    }

    @Test
    void publishRegistersTheWebhookAndTheIngressAuthenticatesDeduplicatesAndSeparatesTypes() throws Exception {
        Workflow workflow = draft("Echo bot", bot);

        publish(workflow).andExpect(status().isOk()).andExpect(jsonPath("$.webhooks.length()").value(0));

        assertEquals(1, telegram.registered.size());
        String[] call = telegram.registered.getFirst();
        Map<String, Object> trigger = jdbc.queryForMap(
                "select id, endpoint_key, secret_hash, status from workflow.workflow_triggers "
                        + "where workflow_id = ? and type = 'TELEGRAM'", workflow.getId());
        String key = (String) trigger.get("endpoint_key");
        assertEquals("https://weav.example.test/api/v1/webhooks/telegram/" + key, call[1]);
        assertEquals("ACTIVE", trigger.get("status"));
        assertEquals(sha256(call[2]), trigger.get("secret_hash"));
        assertTrue(call[2].matches("[A-Za-z0-9_-]{32,256}"), "secret_token alphabet and length for Telegram");
        assertNotEquals(call[2], trigger.get("secret_hash"));

        // Missing, wrong and unknown credentials are the same generic 404.
        telegramUpdate(key, null, update(1, "hi")).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("WEBHOOK_NOT_FOUND"))
                .andExpect(jsonPath("$.path").value("/webhooks/telegram/{endpointKey}"));
        telegramUpdate(key, "wrong", update(1, "hi")).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("WEBHOOK_NOT_FOUND"));
        telegramUpdate("A".repeat(32), call[2], update(1, "hi")).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("WEBHOOK_NOT_FOUND"));
        // The plain webhook route never accepts a Telegram trigger, even with the right secret.
        mockMvc.perform(post("/webhooks/" + key).header("X-Webhook-Secret", call[2])
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isNotFound());
        assertEquals(0, executions(trigger.get("id")));

        telegramUpdate(key, call[2], update(10, "hello")).andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true)).andExpect(jsonPath("$.executionId").exists());
        telegramUpdate(key, call[2], update(10, "hello")).andExpect(status().isOk());
        assertEquals(1, executions(trigger.get("id")), "a redelivered update_id must not run twice");
        Map<String, Object> run = jdbc.queryForMap("select trigger_type, input::text as input_json "
                + "from workflow.workflow_executions where trigger_id = ?", trigger.get("id"));
        assertEquals("TELEGRAM", run.get("trigger_type"));
        assertTrue(((String) run.get("input_json")).contains("\"updateId\": 10"));
        assertTrue(((String) run.get("input_json")).contains("\"text\": \"hello\""));
        assertTrue(!((String) run.get("input_json")).contains("ignored"));

        telegramUpdate(key, call[2], Map.of("update_id", 11, "message", Map.of("photo", List.of())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.executionId").doesNotExist());
        assertEquals(1, executions(trigger.get("id")), "an update without text starts nothing");
    }

    @Test
    void aBotServesOneActiveWorkflowAndPauseAndResumeMoveTheWebhook() throws Exception {
        Workflow first = draft("First", bot);
        Workflow second = draft("Second", bot);
        publish(first).andExpect(status().isOk());
        String[] firstCall = telegram.registered.getFirst();

        publish(second).andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("TELEGRAM_BOT_IN_USE"));
        assertEquals(1, telegram.registered.size());
        assertEquals(0, jdbc.queryForObject("select count(*) from workflow.workflow_triggers where workflow_id = ?",
                Integer.class, second.getId()), "a refused publish leaves no registration behind");

        mockMvc.perform(post(path(first, "pause")).header("Authorization", "Bearer " + accessToken()))
                .andExpect(status().isOk());
        assertEquals(List.of(bot), telegram.unregistered);
        String key = jdbc.queryForObject("select endpoint_key from workflow.workflow_triggers "
                + "where workflow_id = ? and type = 'TELEGRAM'", String.class, first.getId());
        telegramUpdate(key, firstCall[2], update(20, "while paused")).andExpect(status().isNotFound());

        // The bot is free while the first workflow is paused, so the second one can take it ...
        publish(second).andExpect(status().isOk());
        assertEquals(2, telegram.registered.size());
        // ... and the first one can no longer resume.
        mockMvc.perform(post(path(first, "resume")).header("Authorization", "Bearer " + accessToken()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("TELEGRAM_BOT_IN_USE"));

        mockMvc.perform(post(path(second, "pause")).header("Authorization", "Bearer " + accessToken()))
                .andExpect(status().isOk());
        mockMvc.perform(post(path(first, "resume")).header("Authorization", "Bearer " + accessToken()))
                .andExpect(status().isOk());
        String[] resumedCall = telegram.registered.getLast();
        assertNotEquals(firstCall[2], resumedCall[2], "resume issues a new secret_token");
        telegramUpdate(key, firstCall[2], update(21, "old secret")).andExpect(status().isNotFound());
        telegramUpdate(key, resumedCall[2], update(21, "new secret")).andExpect(status().isOk())
                .andExpect(jsonPath("$.executionId").exists());
    }

    @Test
    void twoConcurrentPublishesOnTheSameBotLetExactlyOneWin() throws Exception {
        Workflow first = draft("Concurrent A", bot);
        Workflow second = draft("Concurrent B", bot);
        telegram.delayMillis = 400; // keeps the winner inside its transaction so the loser really waits on the lock
        String token = accessToken();
        java.util.concurrent.CountDownLatch go = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            List<java.util.concurrent.Future<org.springframework.mock.web.MockHttpServletResponse>> results = new ArrayList<>();
            for (Workflow workflow : List.of(first, second)) {
                results.add(pool.submit(() -> {
                    go.await();
                    return mockMvc.perform(post(path(workflow, "publish")).header("Authorization", "Bearer " + token))
                            .andReturn().getResponse();
                }));
            }
            go.countDown();
            List<Integer> statuses = new ArrayList<>();
            int conflicts = 0;
            for (var result : results) {
                var response = result.get(60, java.util.concurrent.TimeUnit.SECONDS);
                statuses.add(response.getStatus());
                if (response.getStatus() == 409) {
                    assertTrue(response.getContentAsString().contains("TELEGRAM_BOT_IN_USE"));
                    conflicts++;
                }
            }
            assertEquals(1, statuses.stream().filter(status -> status == 200).count(), statuses::toString);
            assertEquals(1, conflicts, statuses::toString);
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, telegram.registered.size());
        assertEquals(1, jdbc.queryForObject("select count(*) from workflow.workflow_triggers t "
                + "join workflow.workflows w on w.id = t.workflow_id where w.workspace_id = ? "
                + "and t.type = 'TELEGRAM' and t.status = 'ACTIVE'", Integer.class, workspaceId));
    }

    @Test
    void failedRegistrationFailsThePublishWithAStableCodeAndRollsBackEverything() throws Exception {
        Workflow workflow = draft("Rejected", bot);
        telegram.fail = true;

        publish(workflow).andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("TELEGRAM_WEBHOOK_REGISTRATION_FAILED"));

        assertEquals(0, jdbc.queryForObject("select count(*) from workflow.workflow_triggers where workflow_id = ?",
                Integer.class, workflow.getId()));
        assertEquals(0, jdbc.queryForObject("select count(*) from workflow.workflow_versions where workflow_id = ?",
                Integer.class, workflow.getId()));
        assertEquals("DRAFT", jdbc.queryForObject("select status from workflow.workflows where id = ?",
                String.class, workflow.getId()));
    }

    @Test
    void republishingSupersedesTheOldTriggerAndRegistersTheNewOne() throws Exception {
        Workflow workflow = draft("Republished", bot);
        publish(workflow).andExpect(status().isOk());
        String[] first = telegram.registered.getFirst();
        String oldKey = jdbc.queryForObject("select endpoint_key from workflow.workflow_triggers "
                + "where workflow_id = ? and type = 'TELEGRAM'", String.class, workflow.getId());

        Workflow edited = workflows.findByWorkspaceAndId(workspaceId, workflow.getId()).orElseThrow();
        Map<String, Object> definition = new LinkedHashMap<>(edited.getDraftDefinition());
        definition.put("variables", Map.of("revision", "2"));
        edited.updateDraft(edited.getName(), edited.getDescription(), definition, Map.of());
        workflows.save(edited);
        publish(workflow).andExpect(status().isOk());

        assertEquals(2, telegram.registered.size());
        assertEquals(List.of(), telegram.unregistered, "the same bot is replaced, not cleared");
        assertNotEquals(first[2], telegram.registered.getLast()[2]);
        telegramUpdate(oldKey, first[2], update(30, "stale")).andExpect(status().isNotFound());
    }

    // ---- helpers

    private org.springframework.test.web.servlet.ResultActions publish(Workflow workflow) throws Exception {
        return mockMvc.perform(post(path(workflow, "publish")).header("Authorization", "Bearer " + accessToken()));
    }

    private org.springframework.test.web.servlet.ResultActions telegramUpdate(
            String key, String secret, Object body) throws Exception {
        var request = post("/webhooks/telegram/" + key).contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body));
        if (secret != null) {
            request = request.header("X-Telegram-Bot-Api-Secret-Token", secret);
        }
        return mockMvc.perform(request);
    }

    private static Map<String, Object> update(int id, String text) {
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("message_id", id);
        message.put("date", 1_700_000_000);
        message.put("text", text);
        message.put("chat", Map.of("id", 4242, "type", "private", "first_name", "ignored"));
        message.put("from", Map.of("id", 4242, "is_bot", false, "first_name", "Ada", "username", "ada"));
        return Map.of("update_id", id, "message", message);
    }

    private long executions(Object triggerId) {
        return jdbc.queryForObject("select count(*) from workflow.workflow_executions where trigger_id = ?",
                Long.class, triggerId);
    }

    private Workflow draft(String name, UUID connection) {
        Workflow workflow = workflows.save(Workflow.createDraft(workspaceId, name, "Description", USER_ID));
        Map<String, Object> manual = new LinkedHashMap<>();
        manual.put("id", "manual");
        manual.put("type", "trigger.manual");
        manual.put("config", Map.of());
        Map<String, Object> telegramNode = new LinkedHashMap<>();
        telegramNode.put("id", "telegram");
        telegramNode.put("type", "trigger.telegram");
        telegramNode.put("config", Map.of("connectionId", connection.toString()));
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("schemaVersion", "1.0");
        definition.put("nodes", new ArrayList<>(List.of(manual, telegramNode)));
        definition.put("edges", List.of());
        definition.put("variables", Map.of());
        workflow.updateDraft(workflow.getName(), workflow.getDescription(), definition, Map.of());
        return workflows.save(workflow);
    }

    private String path(Workflow workflow, String operation) {
        return "/workspaces/" + workspaceId + "/workflows/" + workflow.getId() + "/" + operation;
    }

    private static String sha256(String value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    private String accessToken() throws Exception {
        Instant now = Instant.now();
        Map<String, Object> header = Map.of("alg", "HS256", "typ", "JWT");
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("iss", "weav-identity");
        claims.put("sub", USER_ID.toString());
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
        return Base64.getUrlEncoder().withoutPadding().encodeToString(objectMapper.writeValueAsBytes(value));
    }
}
