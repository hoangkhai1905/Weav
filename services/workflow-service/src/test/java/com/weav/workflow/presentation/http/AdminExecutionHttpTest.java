package com.weav.workflow.presentation.http;

import com.weav.workflow.WorkflowDraftTestConfiguration;
import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.infrastructure.security.JwtProperties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.web.servlet.MockMvc;
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
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** UC028: cross-workspace admin run listing, detail and summary against a real PostgreSQL (Testcontainers). */
@SpringBootTest
@Import(WorkflowDraftTestConfiguration.class)
class AdminExecutionHttpTest {
    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000082");
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

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        workspaceBoundary.setCapabilities(ALL);
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity()).build();
    }

    @AfterEach
    void tearDown() {
        workspaceBoundary.reset();
    }

    @Test
    void userRoleIsForbiddenOnEveryAdminRoute() throws Exception {
        for (String path : List.of("/admin/executions", "/admin/executions/summary",
                "/admin/executions/" + UUID.randomUUID())) {
            mockMvc.perform(get(path).header("Authorization", bearer("USER"))).andExpect(status().isForbidden());
        }
        mockMvc.perform(get("/admin/executions")).andExpect(status().isUnauthorized());
    }

    @Test
    void listsRunsAcrossWorkspacesNewestFirstWithWorkspaceId() throws Exception {
        UUID workspaceA = UUID.randomUUID();
        UUID workspaceB = UUID.randomUUID();
        UUID flowA = workflow(workspaceA, "Flow A");
        UUID flowB = workflow(workspaceB, "Flow B");
        Instant now = Instant.now();
        UUID oldest = execution(flowA, "SUCCESS", now.minus(Duration.ofHours(3)), 4, null);
        UUID middle = execution(flowB, "FAILED", now.minus(Duration.ofHours(2)), 2, "{\"code\":\"BOOM\"}");
        UUID newest = execution(flowA, "QUEUED", now.minus(Duration.ofMinutes(5)), null, null);

        JsonNode all = json(list("?size=100"));
        // Other tests share the database: keep only the runs created here.
        List<UUID> mine = List.of(newest, middle, oldest);
        assertEquals(mine, ids(all).stream().filter(mine::contains).toList());
        assertTrue(all.get("totalElements").asInt() >= 3);
        for (JsonNode item : all.get("items")) {
            UUID id = UUID.fromString(item.get("executionId").asText());
            if (id.equals(middle)) {
                assertEquals(workspaceB.toString(), item.get("workspaceId").asText());
                assertEquals("Flow B", item.get("workflowName").asText());
                assertEquals(2000, item.get("durationMs").asInt());
                assertEquals("BOOM", item.get("errorCode").asText());
            } else if (id.equals(newest) || id.equals(oldest)) {
                assertEquals(workspaceA.toString(), item.get("workspaceId").asText());
            }
        }

        JsonNode onlyA = json(list("?workspaceId=" + workspaceA));
        assertEquals(List.of(newest, oldest), ids(onlyA));
        assertEquals(2, onlyA.get("totalElements").asInt());
        assertFalse(onlyA.get("hasNext").asBoolean());
        assertTrue(json(list("?workspaceId=" + workspaceA + "&size=1")).get("hasNext").asBoolean());
    }

    @Test
    void filtersByStatusAndRangeAndRejectsRangeOver90Days() throws Exception {
        UUID workspace = UUID.randomUUID();
        UUID flow = workflow(workspace, "Filters");
        Instant now = Instant.now();
        UUID old = execution(flow, "FAILED", now.minus(Duration.ofDays(5)), 1, null);
        UUID failed = execution(flow, "FAILED", now.minus(Duration.ofHours(1)), 1, null);
        UUID ok = execution(flow, "SUCCESS", now.minus(Duration.ofMinutes(10)), 1, null);
        String scope = "&workspaceId=" + workspace;

        assertEquals(List.of(failed, old), ids(json(list("?status=FAILED" + scope))));
        assertEquals(List.of(ok, failed),
                ids(json(list("?from=" + now.minus(Duration.ofDays(1)) + "&to=" + now.plusSeconds(60) + scope))));
        list("?status=NOPE").andExpect(status().isBadRequest());
        list("?from=yesterday").andExpect(status().isBadRequest());
        list("?size=101").andExpect(status().isBadRequest());
        list("?from=" + now.minus(Duration.ofDays(100)) + "&to=" + now).andExpect(status().isBadRequest());
    }

    @Test
    void excludesRunsOfDeletedWorkflows() throws Exception {
        UUID workspace = UUID.randomUUID();
        UUID flow = workflow(workspace, "Doomed");
        UUID run = execution(flow, "SUCCESS", Instant.now().minusSeconds(30), 1, null);
        assertEquals(List.of(run), ids(json(list("?workspaceId=" + workspace))));
        detail(run).andExpect(status().isOk());

        jdbc.update("update workflow.workflows set deleted_at = now() where id = ?", flow);

        assertEquals(List.of(), ids(json(list("?workspaceId=" + workspace))));
        detail(run).andExpect(status().isNotFound());
        detail(UUID.randomUUID()).andExpect(status().isNotFound());
    }

    @Test
    void detailHasStepsWithoutPayloadsAndRedactsErrors() throws Exception {
        UUID workspace = UUID.randomUUID();
        UUID flow = workflow(workspace, "Steps");
        UUID run = execution(flow, "FAILED", Instant.now().minusSeconds(60), 3,
                "{\"code\":\"STEP_FAILED\",\"message\":\"failed with Bearer abc.def.ghi\"}");
        jdbc.update("insert into workflow.node_executions (id, execution_id, node_id, node_type, status, input, "
                        + "output, error, attempt_count, started_at, finished_at) "
                        + "values (?, ?, 'http-1', 'action.http', 'FAILED', cast(? as jsonb), cast(? as jsonb), "
                        + "cast(? as jsonb), 2, now(), now())",
                UUID.randomUUID(), run, "{\"secret\":\"in-payload\"}", "{\"body\":\"out-payload\"}",
                "{\"code\":\"HTTP_500\",\"message\":\"upstream said Bearer abc.def.ghi\"}");

        String body = detail(run).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        JsonNode detail = objectMapper.readTree(body);

        assertEquals(workspace.toString(), detail.get("workspaceId").asText());
        assertEquals("Steps", detail.get("workflowName").asText());
        assertEquals("STEP_FAILED", detail.get("errorCode").asText());
        assertEquals(1, detail.get("steps").size());
        JsonNode step = detail.get("steps").get(0);
        assertEquals("http-1", step.get("nodeId").asText());
        assertEquals("action.http", step.get("nodeType").asText());
        assertEquals("FAILED", step.get("status").asText());
        assertEquals(2, step.get("attemptCount").asInt());
        assertEquals("HTTP_500", step.get("errorCode").asText());
        assertFalse(body.contains("abc.def.ghi"), "bearer tokens are redacted everywhere");
        assertFalse(body.contains("in-payload") || body.contains("out-payload"), "payloads are never returned");
        assertFalse(step.has("input") || step.has("output") || detail.has("input") || detail.has("output"));
    }

    @Test
    void summaryCountsByStatusInTheWindowAndValidatesHours() throws Exception {
        UUID workspace = UUID.randomUUID();
        UUID flow = workflow(workspace, "Counts");
        UUID deletedFlow = workflow(workspace, "Counts deleted");
        Instant now = Instant.now();
        JsonNode before = json(summary("?hours=24"));

        execution(flow, "SUCCESS", now.minus(Duration.ofHours(1)), 1, null);
        execution(flow, "SUCCESS", now.minus(Duration.ofHours(2)), 1, null);
        execution(flow, "FAILED", now.minus(Duration.ofHours(3)), 1, null);
        execution(flow, "RUNNING", now.minus(Duration.ofMinutes(5)), null, null);
        execution(flow, "WAITING", now.minus(Duration.ofMinutes(4)), null, null);
        execution(flow, "SUCCESS", now.minus(Duration.ofHours(30)), 1, null); // outside 24 h
        execution(deletedFlow, "FAILED", now.minus(Duration.ofHours(1)), 1, null);
        jdbc.update("update workflow.workflows set deleted_at = now() where id = ?", deletedFlow);

        JsonNode after = json(summary("?hours=24"));
        assertEquals(24, after.get("hours").asInt());
        assertEquals(5, delta(before, after, "total"));
        assertEquals(2, delta(before, after, "success"));
        assertEquals(1, delta(before, after, "failed"));
        assertEquals(2, delta(before, after, "active"));
        assertTrue(Instant.parse(after.get("to").asText()).isAfter(Instant.parse(after.get("from").asText())));

        summary("").andExpect(status().isOk());
        summary("?hours=0").andExpect(status().isBadRequest());
        summary("?hours=169").andExpect(status().isBadRequest());
    }

    @Test
    void summaryTrendIsZeroFilledPerUtcDayAcrossWorkspacesAndSkipsDeletedWorkflows() throws Exception {
        UUID flowA = workflow(UUID.randomUUID(), "Trend A");
        UUID flowB = workflow(UUID.randomUUID(), "Trend B");
        UUID deleted = workflow(UUID.randomUUID(), "Trend deleted");
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        JsonNode before = json(summary("?days=5"));

        execution(flowA, "SUCCESS", dayStart(today), 1, null);
        execution(flowB, "FAILED", dayStart(today), 1, null);
        execution(flowA, "RUNNING", dayStart(today), null, null);
        execution(flowA, "SUCCESS", dayNoon(today.minusDays(2)), 1, null);
        execution(flowB, "SUCCESS", dayNoon(today.minusDays(2)), 1, null);
        execution(flowB, "FAILED", dayNoon(today.minusDays(4)), 1, null);
        execution(flowA, "SUCCESS", dayNoon(today.minusDays(5)), 1, null); // before the 5-day window
        execution(deleted, "FAILED", dayNoon(today.minusDays(1)), 1, null);
        jdbc.update("update workflow.workflows set deleted_at = now() where id = ?", deleted);

        JsonNode after = json(summary("?days=5"));
        JsonNode trend = after.get("trend");
        assertEquals(5, trend.size());
        for (int i = 0; i < 5; i++) {
            assertEquals(today.minusDays(4L - i).toString(), trend.get(i).get("day").asText());
        }
        // [total, success, failed] gained per day, oldest first; yesterday stays 0 because its only run belongs to a deleted workflow.
        long[][] expected = {{1, 0, 1}, {0, 0, 0}, {2, 2, 0}, {0, 0, 0}, {3, 1, 1}};
        for (int i = 0; i < 5; i++) {
            assertEquals(expected[i][0], delta(before.get("trend").get(i), trend.get(i), "total"), "total " + i);
            assertEquals(expected[i][1], delta(before.get("trend").get(i), trend.get(i), "success"), "success " + i);
            assertEquals(expected[i][2], delta(before.get("trend").get(i), trend.get(i), "failed"), "failed " + i);
        }
        assertEquals(14, json(summary("")).get("trend").size());
        assertEquals(1, json(summary("?days=1")).get("trend").size());
        assertEquals(30, json(summary("?days=30&hours=1")).get("trend").size());
        summary("?days=0").andExpect(status().isBadRequest());
        summary("?days=31").andExpect(status().isBadRequest());
    }

    @Test
    void summaryTopFailingRanksFailedRunsAcrossWorkspacesAndSkipsDeletedWorkflows() throws Exception {
        UUID[] workspaces = new UUID[7];
        UUID[] flows = new UUID[7];
        for (int i = 0; i < 7; i++) {
            workspaces[i] = UUID.randomUUID();
            flows[i] = workflow(workspaces[i], "Top " + i);
        }
        // Isolate from rows other tests left behind in the shared database.
        String mine = Arrays.stream(flows).map(id -> "'" + id + "'").collect(Collectors.joining(","));
        jdbc.update("update workflow.workflows set deleted_at = now() where deleted_at is null "
                + "and id::text not in (" + mine + ")");
        Instant now = Instant.now();
        // Flows 0 and 1 tie on failures; flow 1 failed more recently, so it ranks first.
        int[] failures = {3, 3, 5, 4, 2, 1, 9};
        for (int i = 0; i < 7; i++) {
            for (int run = 0; run < failures[i]; run++) {
                execution(flows[i], "FAILED", now.minus(Duration.ofHours(1)).minusSeconds(i == 0 ? 600 : 0)
                        .minusSeconds(run), 1, null);
            }
            execution(flows[i], "SUCCESS", now.minus(Duration.ofMinutes(30)), 1, null);
        }
        jdbc.update("update workflow.workflows set deleted_at = now() where id = ?", flows[6]);

        JsonNode top = json(summary("?days=7")).get("topFailing");

        assertEquals(5, top.size());
        int[] order = {2, 3, 1, 0, 4};
        for (int rank = 0; rank < order.length; rank++) {
            int i = order[rank];
            JsonNode item = top.get(rank);
            assertEquals(flows[i].toString(), item.get("workflowId").asText());
            assertEquals("Top " + i, item.get("workflowName").asText());
            assertEquals(workspaces[i].toString(), item.get("workspaceId").asText());
            assertEquals(failures[i], item.get("failures").asInt());
            assertTrue(Instant.parse(item.get("lastFailureAt").asText()).isBefore(now));
        }
        for (JsonNode item : top) {
            assertFalse(item.get("workflowId").asText().equals(flows[6].toString()), "deleted workflow listed");
        }
        assertFalse(top.get(0).has("input") || top.get(0).has("output"));
    }

    // ---------------------------------------------------------------- helpers

    private ResultActions list(String query) throws Exception {
        return mockMvc.perform(get("/admin/executions" + query).header("Authorization", bearer("ADMIN")));
    }

    private ResultActions detail(UUID id) throws Exception {
        return mockMvc.perform(get("/admin/executions/{id}", id).header("Authorization", bearer("ADMIN")));
    }

    private ResultActions summary(String query) throws Exception {
        return mockMvc.perform(get("/admin/executions/summary" + query).header("Authorization", bearer("ADMIN")));
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }

    private static Instant dayStart(LocalDate day) {
        return day.atStartOfDay(ZoneOffset.UTC).toInstant();
    }

    private static Instant dayNoon(LocalDate day) {
        return day.atTime(12, 0).toInstant(ZoneOffset.UTC);
    }

    private static long delta(JsonNode before, JsonNode after, String field) {
        return after.get(field).asLong() - before.get(field).asLong();
    }

    private static List<UUID> ids(JsonNode page) {
        List<UUID> ids = new ArrayList<>();
        page.get("items").forEach(item -> ids.add(UUID.fromString(item.get("executionId").asText())));
        return ids;
    }

    private UUID workflow(UUID workspace, String name) {
        workspaceBoundary.setCapabilities(ALL);
        Workflow draft = workflowDraftService.create(new CreateWorkflowCommand(workspace, USER_ID, name, null));
        workflowDraftService.save(workspace, draft.getId(), USER_ID, name, null,
                new WorkflowDefinition("1.0",
                        List.of(new WorkflowDefinition.Node("manual-root", "trigger.manual", Map.of())),
                        List.of(), Map.of()), Map.of());
        workflowPublicationService.publish(workspace, draft.getId(), USER_ID);
        return draft.getId();
    }

    private UUID execution(UUID workflowId, String status, Instant createdAt, Integer seconds, String errorJson) {
        UUID id = UUID.randomUUID();
        UUID versionId = jdbc.queryForObject(
                "select current_version_id from workflow.workflows where id = ?", UUID.class, workflowId);
        boolean finished = status.equals("SUCCESS") || status.equals("FAILED");
        Instant started = seconds == null ? null : createdAt;
        Instant finishedAt = finished && seconds != null ? createdAt.plusSeconds(seconds) : null;
        jdbc.update("insert into workflow.workflow_executions (id, workflow_id, workflow_version_id, status, "
                        + "trigger_type, started_at, finished_at, created_at, error) "
                        + "values (?, ?, ?, ?, 'MANUAL', ?, ?, ?, cast(? as jsonb))",
                id, workflowId, versionId, status, started == null ? null : Timestamp.from(started),
                finishedAt == null ? null : Timestamp.from(finishedAt), Timestamp.from(createdAt), errorJson);
        return id;
    }

    private String bearer(String systemRole) throws Exception {
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
        claims.put("system_role", systemRole);
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
