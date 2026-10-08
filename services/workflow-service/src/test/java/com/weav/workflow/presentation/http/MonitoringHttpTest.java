package com.weav.workflow.presentation.http;

import com.weav.workflow.WorkflowDraftTestConfiguration;
import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.service.AlertEvaluator;
import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.infrastructure.security.JwtProperties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Run history, summary, alert-rule CRUD and the evaluator against a real PostgreSQL (Testcontainers). */
@SpringBootTest
@Import(WorkflowDraftTestConfiguration.class)
class MonitoringHttpTest {
    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000081");
    private static final Set<String> ALL = Set.of("WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT",
            "WORKFLOW_PUBLISH", "WORKFLOW_RUN", "WORKFLOW_MONITOR", "WORKFLOW_MANAGE_STATE");

    @Autowired
    private WebApplicationContext webApplicationContext;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private JwtProperties jwtProperties;
    @Autowired
    private WorkflowDraftService workflowDraftService;
    @Autowired
    private WorkflowPublicationService workflowPublicationService;
    @Autowired
    private WorkflowDraftTestConfiguration.DraftWorkspaceBoundary workspaceBoundary;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private AlertEvaluator alertEvaluator;
    @Autowired
    private com.weav.workflow.application.port.out.AlertRuleStore alertRuleStore;

    private UUID workspaceId;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        workspaceBoundary.setCapabilities(ALL);
        workspaceId = UUID.randomUUID();
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity()).build();
    }

    @AfterEach
    void tearDown() {
        workspaceBoundary.reset();
    }

    // ---------------------------------------------------------------- run history

    @Test
    void historyFiltersByStatusWorkflowAndRangeAndPagesNewestFirst() throws Exception {
        UUID syncId = workflow(workspaceId, "Sync");
        UUID reportId = workflow(workspaceId, "Report");
        Instant now = Instant.now();
        UUID oldest = execution(syncId, "SUCCESS", "MANUAL", now.minus(Duration.ofDays(5)), 4, null);
        UUID middle = execution(syncId, "FAILED", "SCHEDULE", now.minus(Duration.ofHours(3)), 2,
                "{\"code\":\"HTTP_500\",\"message\":\"upstream said Bearer abc.def.ghi and failed\"}");
        UUID newest = execution(reportId, "FAILED", "WEBHOOK", now.minus(Duration.ofMinutes(10)), 1, null);
        UUID queued = execution(reportId, "QUEUED", "MANUAL", now.minus(Duration.ofMinutes(1)), null, null);
        // Another workspace and a deleted workflow must never leak into this workspace's history.
        UUID foreign = workflow(UUID.randomUUID(), "Foreign");
        execution(foreign, "FAILED", "MANUAL", now.minus(Duration.ofMinutes(5)), 1, null);
        UUID deleted = workflow(workspaceId, "Deleted");
        execution(deleted, "FAILED", "MANUAL", now.minus(Duration.ofMinutes(5)), 1, null);
        jdbc.update("update workflow.workflows set deleted_at = now() where id = ?", deleted);

        JsonNode all = json(history("").andExpect(status().isOk()));
        assertEquals(4, all.get("totalElements").asInt());
        assertEquals(List.of(queued, newest, middle, oldest), ids(all));
        assertEquals("Report", all.get("items").get(0).get("workflowName").asText());
        assertEquals("QUEUED", all.get("items").get(0).get("status").asText());
        assertTrue(all.get("items").get(0).get("durationMs").isNull());
        assertEquals(2000, all.get("items").get(2).get("durationMs").asInt());
        assertEquals("HTTP_500", all.get("items").get(2).get("errorCode").asText());
        assertTrue(!all.get("items").get(2).get("errorMessage").asText().contains("abc.def.ghi"),
                "bearer tokens in stored errors are redacted");

        assertEquals(List.of(newest, middle), ids(json(history("?status=FAILED"))));
        assertEquals(List.of(middle, oldest), ids(json(history("?workflowId=" + syncId))));
        assertEquals(List.of(middle), ids(json(history("?workflowId=" + syncId + "&status=FAILED"))));
        assertEquals(List.of(queued, newest, middle),
                ids(json(history("?from=" + now.minus(Duration.ofDays(1)) + "&to=" + now.plusSeconds(60)))));

        JsonNode secondPage = json(history("?page=1&size=3"));
        assertEquals(List.of(oldest), ids(secondPage));
        assertEquals(false, secondPage.get("hasNext").asBoolean());
        assertEquals(true, json(history("?page=0&size=3")).get("hasNext").asBoolean());
    }

    @Test
    void historyRejectsBadInputAndMissingMonitorCapability() throws Exception {
        history("?status=NOPE").andExpect(status().isBadRequest());
        history("?size=101").andExpect(status().isBadRequest());
        history("?page=-1").andExpect(status().isBadRequest());
        history("?from=yesterday").andExpect(status().isBadRequest());
        Instant now = Instant.now();
        history("?from=" + now.minus(Duration.ofDays(91)) + "&to=" + now).andExpect(status().isBadRequest());

        workspaceBoundary.setCapabilities(Set.of("WORKSPACE_VIEW", "WORKFLOW_EDIT"));
        history("").andExpect(status().isForbidden());
        mockMvc.perform(get("/workspaces/{w}/monitoring/summary", workspaceId).header("Authorization", bearer()))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/workspaces/{w}/alert-rules", workspaceId).header("Authorization", bearer()))
                .andExpect(status().isForbidden());
    }

    @Test
    void historyNeedsAuthentication() throws Exception {
        mockMvc.perform(get("/workspaces/{w}/executions", workspaceId)).andExpect(status().isUnauthorized());
    }

    // ---------------------------------------------------------------- summary

    @Test
    void summaryAggregatesCountsRatesDurationsTrendAndFailures() throws Exception {
        UUID syncId = workflow(workspaceId, "Sync");
        UUID reportId = workflow(workspaceId, "Report");
        jdbc.update("update workflow.workflows set status = 'PAUSED' where id = ?", reportId);
        workflow(workspaceId, "Draft one"); // status PUBLISHED by the helper, flipped below
        jdbc.update("update workflow.workflows set status = 'DRAFT' where workspace_id = ? and name = 'Draft one'",
                workspaceId);
        Instant now = Instant.now();
        Instant recent = now.minusSeconds(30);
        Instant twoDaysAgo = now.minus(Duration.ofDays(2));
        execution(syncId, "SUCCESS", "MANUAL", recent, 2, null);
        execution(syncId, "SUCCESS", "MANUAL", twoDaysAgo, 4, null);
        execution(syncId, "FAILED", "SCHEDULE", twoDaysAgo.minusSeconds(10), 6, "{\"code\":\"BOOM\"}");
        execution(reportId, "FAILED", "WEBHOOK", twoDaysAgo.minusSeconds(20), 8, "{\"code\":\"BOOM\"}");
        execution(reportId, "RUNNING", "MANUAL", recent, null, null);
        execution(syncId, "SUCCESS", "MANUAL", now.minus(Duration.ofDays(20)), 100, null); // outside 7 days
        execution(workflow(UUID.randomUUID(), "Foreign"), "FAILED", "MANUAL", recent, 1, null);

        JsonNode summary = json(mockMvc.perform(get("/workspaces/{w}/monitoring/summary?days=7", workspaceId)
                .header("Authorization", bearer())).andExpect(status().isOk()));

        assertEquals(1, summary.get("workflows").get("paused").asInt());
        assertEquals(1, summary.get("workflows").get("published").asInt());
        assertEquals(1, summary.get("workflows").get("draft").asInt());
        assertEquals(5, summary.get("runs").get("total").asInt());
        assertEquals(2, summary.get("runs").get("success").asInt());
        assertEquals(2, summary.get("runs").get("failed").asInt());
        assertEquals(1, summary.get("runs").get("active").asInt());
        assertEquals(0.5, summary.get("successRate").asDouble());
        // finished runs took 2, 4, 6 and 8 seconds
        assertEquals(5000, summary.get("averageDurationMs").asLong());
        assertTrue(summary.get("p95DurationMs").asLong() >= 7000);
        assertEquals(7, summary.get("trend").size());
        long trendTotal = 0;
        long zeroDays = 0;
        for (JsonNode day : summary.get("trend")) {
            trendTotal += day.get("total").asLong();
            if (day.get("total").asLong() == 0) {
                zeroDays++;
            }
        }
        assertEquals(5, trendTotal);
        assertTrue(zeroDays >= 4, "days without runs are present with zero counts");
        JsonNode top = summary.get("topFailingWorkflows");
        assertEquals(2, top.size());
        assertEquals(1, top.get(0).get("failures").asInt());
        assertEquals(2, summary.get("recentFailures").size());
        assertEquals("BOOM", summary.get("recentFailures").get(0).get("errorCode").asText());
        mockMvc.perform(get("/workspaces/{w}/monitoring/summary?days=31", workspaceId)
                .header("Authorization", bearer())).andExpect(status().isBadRequest());
    }

    @Test
    void summaryOfAnEmptyWorkspaceHasNoRateAndAZeroFilledTrend() throws Exception {
        JsonNode summary = json(mockMvc.perform(get("/workspaces/{w}/monitoring/summary", workspaceId)
                .header("Authorization", bearer())).andExpect(status().isOk()));

        assertEquals(0, summary.get("runs").get("total").asInt());
        assertTrue(summary.get("successRate").isNull());
        assertTrue(summary.get("averageDurationMs").isNull());
        assertEquals(7, summary.get("trend").size());
        assertEquals(0, summary.get("topFailingWorkflows").size());
        assertEquals(0, summary.get("recentFailures").size());
    }

    // ---------------------------------------------------------------- alert rules

    @Test
    void alertRuleCrudValidationAndLimits() throws Exception {
        UUID workflowId = workflow(workspaceId, "Sync");
        UUID foreignWorkflow = workflow(UUID.randomUUID(), "Foreign");

        MvcResult created = rules(post("/workspaces/{w}/alert-rules", workspaceId),
                "{\"name\":\"Sync breaks\",\"type\":\"CONSECUTIVE_FAILURES\",\"workflowId\":\"" + workflowId
                        + "\",\"threshold\":3,\"windowMinutes\":30}").andExpect(status().isCreated())
                .andExpect(jsonPath("$.cooldownMinutes").value(60))
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.createdBy").value(USER_ID.toString())).andReturn();
        String ruleId = objectMapper.readTree(created.getResponse().getContentAsString()).get("id").asText();

        mockMvc.perform(get("/workspaces/{w}/alert-rules", workspaceId).header("Authorization", bearer()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.maxRules").value(20));

        rules(put("/workspaces/{w}/alert-rules/{id}", workspaceId, ruleId),
                "{\"name\":\"Slow\",\"type\":\"LONG_RUNNING\",\"threshold\":90,\"cooldownMinutes\":5,"
                        + "\"enabled\":false}").andExpect(status().isOk())
                .andExpect(jsonPath("$.type").value("LONG_RUNNING"))
                .andExpect(jsonPath("$.workflowId").doesNotExist())
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.cooldownMinutes").value(5));

        rules(post("/workspaces/{w}/alert-rules", workspaceId),
                "{\"name\":\"x\",\"type\":\"CONSECUTIVE_FAILURES\",\"workflowId\":\"" + foreignWorkflow
                        + "\",\"threshold\":3,\"windowMinutes\":30}").andExpect(status().isBadRequest());
        rules(post("/workspaces/{w}/alert-rules", workspaceId),
                "{\"name\":\"x\",\"type\":\"CONSECUTIVE_FAILURES\",\"threshold\":99,\"windowMinutes\":30}")
                .andExpect(status().isBadRequest());
        rules(post("/workspaces/{w}/alert-rules", workspaceId), "{\"name\":\"x\",\"type\":\"WHAT\",\"threshold\":1}")
                .andExpect(status().isBadRequest());
        rules(put("/workspaces/{w}/alert-rules/{id}", workspaceId, UUID.randomUUID()),
                "{\"name\":\"x\",\"type\":\"LONG_RUNNING\",\"threshold\":1}").andExpect(status().isNotFound());

        workspaceBoundary.setCapabilities(Set.of("WORKFLOW_MONITOR"));
        rules(post("/workspaces/{w}/alert-rules", workspaceId),
                "{\"name\":\"x\",\"type\":\"LONG_RUNNING\",\"threshold\":1}").andExpect(status().isForbidden());
        mockMvc.perform(delete("/workspaces/{w}/alert-rules/{id}", workspaceId, ruleId)
                .header("Authorization", bearer())).andExpect(status().isForbidden());
        workspaceBoundary.setCapabilities(ALL);

        mockMvc.perform(delete("/workspaces/{w}/alert-rules/{id}", workspaceId, ruleId)
                .header("Authorization", bearer())).andExpect(status().isNoContent());
        mockMvc.perform(delete("/workspaces/{w}/alert-rules/{id}", workspaceId, ruleId)
                .header("Authorization", bearer())).andExpect(status().isNotFound());

        for (int i = 0; i < 20; i++) {
            rules(post("/workspaces/{w}/alert-rules", workspaceId),
                    "{\"name\":\"r" + i + "\",\"type\":\"LONG_RUNNING\",\"threshold\":10}")
                    .andExpect(status().isCreated());
        }
        rules(post("/workspaces/{w}/alert-rules", workspaceId),
                "{\"name\":\"one too many\",\"type\":\"LONG_RUNNING\",\"threshold\":10}")
                .andExpect(status().isConflict());
    }

    // ---------------------------------------------------------------- evaluator on a real database

    @Test
    void consecutiveFailureRuleFiresOncePerRunAndRespectsTheCooldown() throws Exception {
        UUID workflowId = workflow(workspaceId, "Nightly");
        UUID ruleId = createRule("{\"name\":\"Two in a row\",\"type\":\"CONSECUTIVE_FAILURES\",\"threshold\":2,"
                + "\"windowMinutes\":60,\"cooldownMinutes\":30}");
        Instant now = Instant.now();
        UUID first = execution(workflowId, "FAILED", "SCHEDULE", now.minusSeconds(120), 1, null);
        alertEvaluator.onExecutionFinished(first);
        assertEquals(0, alertNotifications(), "one failure is below the threshold of two");

        UUID second = execution(workflowId, "FAILED", "SCHEDULE", now.minusSeconds(60), 1, null);
        alertEvaluator.onExecutionFinished(second);
        assertEquals(1, alertNotifications());
        Map<String, Object> row = jdbc.queryForMap("select * from workflow.notification_outbox "
                + "where event_type = 'monitoring.alert.consecutive_failures'");
        assertEquals(USER_ID, row.get("recipient_user_id"));
        assertEquals(second, row.get("entity_id"));
        assertEquals("EXECUTION", row.get("entity_kind"));
        JsonNode payload = objectMapper.readTree(row.get("payload").toString());
        assertEquals(2, payload.get("schemaVersion").asInt());
        assertEquals("Two in a row", payload.get("data").get("ruleName").asText());
        assertEquals("Nightly", payload.get("data").get("workflowName").asText());
        assertEquals("2", payload.get("data").get("failureCount").asText());
        assertEquals(workflowId.toString(), payload.get("data").get("workflowId").asText());

        alertEvaluator.onExecutionFinished(second);
        assertEquals(1, alertNotifications(), "the same run never fires the same rule twice");

        UUID third = execution(workflowId, "FAILED", "SCHEDULE", now, 1, null);
        alertEvaluator.onExecutionFinished(third);
        assertEquals(1, alertNotifications(), "inside the cooldown");

        jdbc.update("update workflow.alert_rule_firings set fired_at = now() - interval '2 hours' where rule_id = ?",
                ruleId);
        alertEvaluator.onExecutionFinished(third);
        assertEquals(2, alertNotifications(), "after the cooldown the next failing run fires again");
    }

    @Test
    void disabledRulesAndSuccessfulStreakBreaksStaySilent() throws Exception {
        UUID workflowId = workflow(workspaceId, "Quiet");
        createRule("{\"name\":\"Off\",\"type\":\"LONG_RUNNING\",\"threshold\":1,\"enabled\":false}");
        createRule("{\"name\":\"Streak\",\"type\":\"CONSECUTIVE_FAILURES\",\"threshold\":2,\"windowMinutes\":60}");
        Instant now = Instant.now();
        execution(workflowId, "FAILED", "MANUAL", now.minusSeconds(100), 1, null);
        execution(workflowId, "SUCCESS", "MANUAL", now.minusSeconds(50), 1, null);
        UUID failed = execution(workflowId, "FAILED", "MANUAL", now, 50, null);

        alertEvaluator.onExecutionFinished(failed);

        assertEquals(0, alertNotifications());
    }

    @Test
    void longRunningRuleFiresForARunLongerThanTheThreshold() throws Exception {
        UUID workflowId = workflow(workspaceId, "Heavy");
        createRule("{\"name\":\"Too slow\",\"type\":\"LONG_RUNNING\",\"threshold\":60}");
        UUID quick = execution(workflowId, "SUCCESS", "MANUAL", Instant.now().minusSeconds(500), 30, null);
        UUID slow = execution(workflowId, "SUCCESS", "MANUAL", Instant.now().minusSeconds(400), 125, null);

        alertEvaluator.onExecutionFinished(quick);
        assertEquals(0, alertNotifications());
        alertEvaluator.onExecutionFinished(slow);

        assertEquals(1, jdbc.queryForObject("select count(*) from workflow.notification_outbox "
                + "where event_type = 'monitoring.alert.long_running' and entity_id = ?", Integer.class, slow));
    }

    @Test
    void zeroCooldownStillFiresOnceForTheSameRunEvaluatedTwice() throws Exception {
        UUID workflowId = workflow(workspaceId, "Flaky");
        createRule("{\"name\":\"Every failure\",\"type\":\"CONSECUTIVE_FAILURES\",\"threshold\":1,"
                + "\"windowMinutes\":60,\"cooldownMinutes\":0}");
        UUID failed = execution(workflowId, "FAILED", "MANUAL", Instant.now().minusSeconds(5), 1, null);

        alertEvaluator.onExecutionFinished(failed);
        alertEvaluator.onExecutionFinished(failed);

        // One firing; rule creator == workflow creator, so exactly one outbox row.
        assertEquals(1, alertNotifications());
        assertEquals(1, jdbc.queryForObject("select count(*) from workflow.alert_rule_firings f "
                + "join workflow.alert_rules r on r.id = f.rule_id where r.workspace_id = ?", Integer.class,
                workspaceId));
    }

    @Test
    void anotherWorkspacesRealRuleIdIsNotFoundForUpdateAndDelete() throws Exception {
        UUID ruleId = createRule("{\"name\":\"Mine\",\"type\":\"LONG_RUNNING\",\"threshold\":30}");
        UUID otherWorkspace = UUID.randomUUID();

        rules(put("/workspaces/{w}/alert-rules/{id}", otherWorkspace, ruleId),
                "{\"name\":\"Hijack\",\"type\":\"LONG_RUNNING\",\"threshold\":1}")
                .andExpect(status().isNotFound());
        mockMvc.perform(delete("/workspaces/{w}/alert-rules/{id}", otherWorkspace, ruleId)
                .header("Authorization", bearer())).andExpect(status().isNotFound());

        assertEquals(1, jdbc.queryForObject("select count(*) from workflow.alert_rules where id = ? "
                + "and name = 'Mine'", Integer.class, ruleId));
    }

    @Test
    void rulesOfASoftDeletedWorkflowAreHiddenAndFreeTheirSlot() throws Exception {
        UUID workflowId = workflow(workspaceId, "Short lived");
        createRule("{\"name\":\"Scoped\",\"type\":\"LONG_RUNNING\",\"workflowId\":\"" + workflowId
                + "\",\"threshold\":30}");
        createRule("{\"name\":\"Everywhere\",\"type\":\"LONG_RUNNING\",\"threshold\":30}");
        mockMvc.perform(get("/workspaces/{w}/alert-rules", workspaceId).header("Authorization", bearer()))
                .andExpect(jsonPath("$.items.length()").value(2));

        jdbc.update("update workflow.workflows set deleted_at = now() where id = ?", workflowId);

        mockMvc.perform(get("/workspaces/{w}/alert-rules", workspaceId).header("Authorization", bearer()))
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].name").value("Everywhere"));
    }

    @Test
    void concurrentCreatesCannotExceedTheCap() throws Exception {
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            java.util.concurrent.CountDownLatch go = new java.util.concurrent.CountDownLatch(1);
            List<java.util.concurrent.Future<Boolean>> results = new java.util.ArrayList<>();
            for (int i = 0; i < 2; i++) {
                results.add(pool.submit(() -> {
                    go.await();
                    return alertRuleStore.insertIfBelowLimit(
                            new com.weav.workflow.application.port.out.AlertRuleStore.AlertRule(UUID.randomUUID(),
                                    workspaceId, null, "race",
                                    com.weav.workflow.domain.valueobject.AlertRuleType.LONG_RUNNING, 10, null, 60,
                                    true, USER_ID, Instant.now(), Instant.now()), 1);
                }));
            }
            go.countDown();
            int inserted = 0;
            for (java.util.concurrent.Future<Boolean> result : results) {
                inserted += result.get(30, java.util.concurrent.TimeUnit.SECONDS) ? 1 : 0;
            }
            assertEquals(1, inserted);
            assertEquals(1, jdbc.queryForObject("select count(*) from workflow.alert_rules where workspace_id = ?",
                    Integer.class, workspaceId));
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void summaryIgnoresDeletedWorkflows() throws Exception {
        UUID liveId = workflow(workspaceId, "Live");
        UUID deletedId = workflow(workspaceId, "Gone");
        Instant now = Instant.now();
        execution(liveId, "SUCCESS", "MANUAL", now.minusSeconds(60), 1, null);
        execution(deletedId, "FAILED", "MANUAL", now.minusSeconds(60), 1, null);
        jdbc.update("update workflow.workflows set deleted_at = now() where id = ?", deletedId);

        JsonNode summary = json(mockMvc.perform(get("/workspaces/{w}/monitoring/summary", workspaceId)
                .header("Authorization", bearer())).andExpect(status().isOk()));

        assertEquals(1, summary.get("runs").get("total").asInt());
        assertEquals(0, summary.get("runs").get("failed").asInt());
        assertEquals(0, summary.get("topFailingWorkflows").size());
        assertEquals(1, summary.get("workflows").get("published").asInt());
    }

    @Test
    void historyToIsExclusiveAndTheDefaultRangeIsNinetyDays() throws Exception {
        UUID workflowId = workflow(workspaceId, "Edges");
        Instant boundary = Instant.parse("2026-09-01T10:00:00Z");
        UUID before = execution(workflowId, "SUCCESS", "MANUAL", boundary.minusSeconds(1), 1, null);
        UUID exactly = execution(workflowId, "SUCCESS", "MANUAL", boundary, 1, null);
        execution(workflowId, "SUCCESS", "MANUAL", Instant.now().minus(Duration.ofDays(100)), 1, null);

        assertEquals(List.of(before),
                ids(json(history("?from=" + boundary.minus(Duration.ofDays(1)) + "&to=" + boundary))));
        assertEquals(List.of(exactly),
                ids(json(history("?from=" + boundary + "&to=" + boundary.plusSeconds(1)))));

        // No filters: the 100-day-old run and the September runs are outside the default 90-day window.
        UUID recent = execution(workflowId, "SUCCESS", "MANUAL", Instant.now().minusSeconds(30), 1, null);
        assertTrue(ids(json(history(""))).contains(recent));
        history("?from=" + Instant.now().minus(Duration.ofDays(100))).andExpect(status().isBadRequest());
    }

    // ---------------------------------------------------------------- LONG_RUNNING watchdog

    @Test
    void sweepFiresOnceForARunThatIsStillRunningAndNotAgainOnTheNextSweepOrOnCompletion() throws Exception {
        UUID workflowId = workflow(workspaceId, "Stuck");
        createRule("{\"name\":\"Stuck run\",\"type\":\"LONG_RUNNING\",\"threshold\":60,\"cooldownMinutes\":0}");
        UUID running = execution(workflowId, "RUNNING", "MANUAL", Instant.now().minusSeconds(600), null, null);
        UUID young = execution(workflowId, "RUNNING", "MANUAL", Instant.now().minusSeconds(10), null, null);
        jdbc.update("update workflow.workflow_executions set started_at = created_at where id in (?, ?)",
                running, young);

        alertEvaluator.sweepOverdue(200);

        assertEquals(1, jdbc.queryForObject("select count(*) from workflow.notification_outbox where entity_id = ? "
                + "and event_type = 'monitoring.alert.long_running'", Integer.class, running));
        assertEquals(0, jdbc.queryForObject("select count(*) from workflow.notification_outbox where entity_id = ?",
                Integer.class, young));
        JsonNode payload = objectMapper.readTree(jdbc.queryForObject(
                "select payload::text from workflow.notification_outbox where entity_id = ?", String.class, running));
        assertTrue(payload.get("data").get("durationSeconds").asInt() >= 600);
        assertEquals("60", payload.get("data").get("thresholdSeconds").asText());

        alertEvaluator.sweepOverdue(200);
        assertEquals(1, alertNotifications(), "the next sweep finds nothing new");

        jdbc.update("update workflow.workflow_executions set status = 'SUCCESS', finished_at = now() where id = ?",
                running);
        alertEvaluator.onExecutionFinished(running);
        assertEquals(1, alertNotifications(), "completion does not alert the same run again");
    }

    @Test
    void sweepIgnoresDisabledRulesOtherWorkspacesAndFinishedRuns() throws Exception {
        UUID workflowId = workflow(workspaceId, "Quiet sweep");
        createRule("{\"name\":\"Off\",\"type\":\"LONG_RUNNING\",\"threshold\":1,\"enabled\":false}");
        // A rule of ANOTHER workspace must not fire for this workspace's runs.
        UUID otherWorkspace = UUID.randomUUID();
        jdbc.update("insert into workflow.alert_rules (id, workspace_id, name, rule_type, threshold, "
                + "cooldown_minutes, created_by) values (?, ?, 'Foreign', 'LONG_RUNNING', 1, 0, ?)",
                UUID.randomUUID(), otherWorkspace, USER_ID);
        UUID running = execution(workflowId, "RUNNING", "MANUAL", Instant.now().minusSeconds(600), null, null);
        jdbc.update("update workflow.workflow_executions set started_at = created_at where id = ?", running);
        execution(workflowId, "SUCCESS", "MANUAL", Instant.now().minusSeconds(900), 700, null);
        execution(workflowId, "FAILED", "MANUAL", Instant.now().minusSeconds(900), 700, null);

        alertEvaluator.sweepOverdue(200);

        assertEquals(0, alertNotifications());
        assertEquals(0, jdbc.queryForObject("select count(*) from workflow.notification_outbox "
                + "where workspace_id = ?", Integer.class, otherWorkspace));
    }

    @Test
    void sweepCoversWorkflowScopedRulesAndNotifiesBothCreators() throws Exception {
        UUID workflowId = workflow(workspaceId, "Scoped");
        UUID otherWorkflow = workflow(workspaceId, "Other");
        UUID ruleCreator = UUID.randomUUID();
        jdbc.update("insert into workflow.alert_rules (id, workspace_id, workflow_id, name, rule_type, threshold, "
                + "cooldown_minutes, created_by) values (?, ?, ?, 'Only scoped', 'LONG_RUNNING', 30, 0, ?)",
                UUID.randomUUID(), workspaceId, workflowId, ruleCreator);
        UUID scopedRun = execution(workflowId, "WAITING", "MANUAL", Instant.now().minusSeconds(300), null, null);
        UUID otherRun = execution(otherWorkflow, "RUNNING", "MANUAL", Instant.now().minusSeconds(300), null, null);
        jdbc.update("update workflow.workflow_executions set started_at = created_at where id in (?, ?)",
                scopedRun, otherRun);

        alertEvaluator.sweepOverdue(200);

        assertEquals(2, jdbc.queryForObject("select count(*) from workflow.notification_outbox where entity_id = ?",
                Integer.class, scopedRun), "rule creator and workflow creator");
        assertEquals(0, jdbc.queryForObject("select count(*) from workflow.notification_outbox where entity_id = ?",
                Integer.class, otherRun));
    }

    // ---------------------------------------------------------------- helpers

    private UUID createRule(String body) throws Exception {
        MvcResult result = rules(post("/workspaces/{w}/alert-rules", workspaceId), body)
                .andExpect(status().isCreated()).andReturn();
        return UUID.fromString(objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText());
    }

    private int alertNotifications() {
        return jdbc.queryForObject("select count(*) from workflow.notification_outbox "
                + "where workspace_id = ? and event_type like 'monitoring.alert.%'", Integer.class, workspaceId);
    }

    private ResultActions history(String query) throws Exception {
        return mockMvc.perform(get("/workspaces/{w}/executions" + query, workspaceId)
                .header("Authorization", bearer()));
    }

    private ResultActions rules(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder builder,
                                String body) throws Exception {
        return mockMvc.perform(builder.header("Authorization", bearer())
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }

    private static List<UUID> ids(JsonNode page) {
        List<UUID> ids = new java.util.ArrayList<>();
        page.get("items").forEach(item -> ids.add(UUID.fromString(item.get("executionId").asText())));
        return ids;
    }

    /** A published workflow in {@code workspace}, created through the real services. */
    private UUID workflow(UUID workspace, String name) {
        workspaceBoundary.setCapabilities(ALL);
        Workflow draft = workflowDraftService.create(new CreateWorkflowCommand(workspace, USER_ID, name, null));
        workflowDraftService.save(workspace, draft.getId(), USER_ID, name, null,
                new com.weav.workflow.domain.definition.WorkflowDefinition("1.0",
                        List.of(new com.weav.workflow.domain.definition.WorkflowDefinition.Node(
                                "manual-root", "trigger.manual", Map.of())), List.of(), Map.of()), Map.of());
        workflowPublicationService.publish(workspace, draft.getId(), USER_ID);
        return draft.getId();
    }

    /** Inserts a run created at {@code createdAt}; a duration makes it start at createdAt and finish after it. */
    private UUID execution(UUID workflowId, String status, String trigger, Instant createdAt, Integer seconds,
                           String errorJson) {
        UUID id = UUID.randomUUID();
        UUID versionId = jdbc.queryForObject(
                "select current_version_id from workflow.workflows where id = ?", UUID.class, workflowId);
        boolean finished = status.equals("SUCCESS") || status.equals("FAILED");
        Instant started = seconds == null ? null : createdAt;
        Instant finishedAt = finished && seconds != null ? createdAt.plusSeconds(seconds) : null;
        jdbc.update("insert into workflow.workflow_executions (id, workflow_id, workflow_version_id, status, "
                        + "trigger_type, started_at, finished_at, created_at, error) "
                        + "values (?, ?, ?, ?, ?, ?, ?, ?, cast(? as jsonb))",
                id, workflowId, versionId, status, trigger, started == null ? null : Timestamp.from(started),
                finishedAt == null ? null : Timestamp.from(finishedAt), Timestamp.from(createdAt), errorJson);
        return id;
    }

    private String bearer() throws Exception {
        Instant now = Instant.now();
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("iss", jwtProperties.issuer());
        claims.put("sub", USER_ID.toString());
        claims.put("aud", List.of(jwtProperties.audience()));
        claims.put("iat", now.getEpochSecond());
        claims.put("nbf", now.getEpochSecond());
        claims.put("exp", now.plusSeconds(300).getEpochSecond());
        claims.put("jti", UUID.randomUUID().toString());
        claims.put("sid", UUID.randomUUID().toString());
        claims.put("system_role", "USER");
        claims.put("user_status", "ACTIVE");
        claims.put("token_use", "access");
        String input = encode(Map.of("alg", "HS256", "typ", "JWT")) + "." + encode(claims);
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(jwtProperties.accessSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return "Bearer " + input + "." + Base64.getUrlEncoder().withoutPadding()
                .encodeToString(mac.doFinal(input.getBytes(StandardCharsets.UTF_8)));
    }

    private String encode(Object value) throws Exception {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(objectMapper.writeValueAsBytes(value));
    }
}
