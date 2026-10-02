package com.weav.workflow.presentation.http;

import com.weav.workflow.WorkflowDraftTestConfiguration;
import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import com.weav.workflow.infrastructure.security.JwtProperties;
import com.weav.workflow.infrastructure.web.WorkflowRequestBodyLimitFilter;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
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
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(WorkflowDraftTestConfiguration.class)
class WorkflowExecutionHttpTest {

    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000061");
    private static final Set<String> ALL_CAPABILITIES = Set.of(
            "WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT", "WORKFLOW_PUBLISH",
            "WORKFLOW_RUN", "WORKFLOW_MONITOR", "WORKFLOW_MANAGE_STATE");

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
    private WorkflowRepository workflowRepository;

    @Autowired
    private WorkflowDraftTestConfiguration.DraftWorkspaceBoundary workspaceBoundary;

    @Autowired
    private WorkflowRequestBodyLimitFilter requestBodyLimitFilter;

    @Autowired
    private org.springframework.jdbc.core.JdbcTemplate jdbc;

    @Value("${local.server.port}")
    private int port;

    private UUID workspaceId;
    private MockMvc mockMvc;
    private final HttpClient httpClient = HttpClient.newHttpClient();

    @BeforeEach
    void setUp() {
        workspaceBoundary.setCapabilities(ALL_CAPABILITIES);
        workspaceId = UUID.randomUUID();
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .addFilters(requestBodyLimitFilter)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
    }

    @AfterEach
    void tearDown() {
        workspaceBoundary.reset();
    }

    @Test
    void admitsAnObjectInputOnlyAfterExecutionAndOutboxCommit() throws Exception {
        UUID workflowId = createPublishedWorkflow("manual-root");

        MvcResult result = mockMvc.perform(post("/workspaces/{workspaceId}/workflows/{workflowId}/executions",
                                workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"input\":{\"count\":2,\"nested\":{\"value\":true}}}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.executionId").isNotEmpty())
                .andExpect(jsonPath("$.workflowId").value(workflowId.toString()))
                .andExpect(jsonPath("$.workflowVersionId").isNotEmpty())
                .andExpect(jsonPath("$.status").value("QUEUED"))
                .andReturn();

        UUID executionId = UUID.fromString(objectMapper.readTree(result.getResponse().getContentAsString())
                .path("executionId").stringValue());
        assertEquals(1, workflowRepository.countByWorkspace(workspaceId));
        assertEquals(1, count("select count(*) from workflow.workflow_executions where id = ?", executionId));
        assertEquals(1, count("select count(*) from workflow.outbox_events where aggregate_id = ? and status = 'PENDING'",
                executionId));
        assertEquals("QUEUED", scalar("select status from workflow.workflow_executions where id = ?", executionId));
    }

    @Test
    void realHttpWithSignedJwtReturnsOnlyAfterAdmissionCommit() throws Exception {
        UUID workflowId = createPublishedWorkflow("embedded-http-root");
        URI endpoint = URI.create("http://localhost:" + port + "/workspaces/" + workspaceId
                + "/workflows/" + workflowId + "/executions");

        HttpResponse<String> response = httpClient.send(
                HttpRequest.newBuilder(endpoint)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString("{\"input\":{\"source\":\"real-http\"}}"))
                        .build(),
                HttpResponse.BodyHandlers.ofString());

        assertEquals(202, response.statusCode(), response.body());
        UUID executionId = UUID.fromString(objectMapper.readTree(response.body())
                .path("executionId").stringValue());
        assertEquals(1, count("select count(*) from workflow.workflow_executions where id = ?", executionId));
        assertEquals(1, count("select count(*) from workflow.outbox_events where aggregate_id = ? and status = 'PENDING'",
                executionId));
    }

    @Test
    void rejectsNonObjectMalformedAndOversizedManualInputsBeforeAdmission() throws Exception {
        UUID workflowId = createPublishedWorkflow("bounded-root");

        mockMvc.perform(post("/workspaces/{workspaceId}/workflows/{workflowId}/executions", workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"input\":[1,2,3]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("MALFORMED_REQUEST"));

        mockMvc.perform(post("/workspaces/{workspaceId}/workflows/{workflowId}/executions", workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("MALFORMED_REQUEST"));

        String oversizedBody = "{\"input\":{\"padding\":\"" + "x".repeat(1_048_600) + "\"}}";
        mockMvc.perform(post("/workspaces/{workspaceId}/workflows/{workflowId}/executions", workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(oversizedBody))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.error.code").value("REQUEST_TOO_LARGE"));

        assertEquals(0, count("select count(*) from workflow.workflow_executions where workflow_id = ?", workflowId));
    }

    @Test
    void runAndMonitorCapabilitiesAreDistinct() throws Exception {
        UUID workflowId = createPublishedWorkflow("capability-root");

        workspaceBoundary.setCapabilities(Set.of("WORKSPACE_VIEW", "WORKFLOW_MONITOR"));
        mockMvc.perform(post("/workspaces/{workspaceId}/workflows/{workflowId}/executions", workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"input\":{}}"))
                .andExpect(status().isForbidden());

        workspaceBoundary.setCapabilities(Set.of("WORKSPACE_VIEW", "WORKFLOW_RUN"));
        mockMvc.perform(get("/workspaces/{workspaceId}/workflows/{workflowId}/executions", workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isForbidden());
    }

    @Test
    void rejectsDraftAndPausedWorkflows() throws Exception {
        Workflow draft = workflowDraftService.create(new CreateWorkflowCommand(
                workspaceId, USER_ID, "Draft", null));
        mockMvc.perform(post("/workspaces/{workspaceId}/workflows/{workflowId}/executions",
                                workspaceId, draft.getId())
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"input\":{}}"))
                .andExpect(status().isUnprocessableEntity());

        UUID pausedId = createPublishedWorkflow("paused-root");
        workflowPublicationService.pause(workspaceId, pausedId, USER_ID);
        mockMvc.perform(post("/workspaces/{workspaceId}/workflows/{workflowId}/executions",
                                workspaceId, pausedId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"input\":{}}"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void listsExecutionsWithStablePaginationAndEnforcesWorkspaceTuple() throws Exception {
        UUID workflowId = createPublishedWorkflow("pagination-root");
        for (int index = 0; index < 5; index++) {
            admit(workflowId, "marker-" + index);
        }

        MvcResult first = mockMvc.perform(get("/workspaces/{workspaceId}/workflows/{workflowId}/executions"
                                + "?page=0&size=2", workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(2))
                .andExpect(jsonPath("$.totalElements").value(5))
                .andReturn();
        MvcResult second = mockMvc.perform(get("/workspaces/{workspaceId}/workflows/{workflowId}/executions"
                                + "?page=1&size=2", workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andReturn();

        JsonNode firstItems = objectMapper.readTree(first.getResponse().getContentAsString()).path("items");
        JsonNode secondItems = objectMapper.readTree(second.getResponse().getContentAsString()).path("items");
        assertFalse(firstItems.get(0).path("executionId").stringValue()
                .equals(secondItems.get(0).path("executionId").stringValue()));

        UUID executionId = UUID.fromString(firstItems.get(0).path("executionId").stringValue());
        mockMvc.perform(get("/workspaces/{workspaceId}/workflows/{workflowId}/executions/{executionId}",
                                UUID.randomUUID(), workflowId, executionId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/workspaces/{workspaceId}/workflows/{workflowId}/executions/{executionId}",
                                workspaceId, UUID.randomUUID(), executionId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isNotFound());
    }

    @Test
    void detailIncludesAttemptAndLogPaginationWithoutPersistedCredentialFields() throws Exception {
        UUID workflowId = createPublishedWorkflow("detail-root");
        UUID executionId = admit(workflowId, "detail");
        UUID nodeExecutionId = jdbcUuid("select id from workflow.node_executions where execution_id = ?", executionId);
        UUID attemptId = UUID.randomUUID();
        String secret = "persisted-provider-secret-marker";
        jdbc.update("""
                insert into workflow.node_execution_attempts
                    (id, node_execution_id, attempt_number, status, input, output, error, started_at, created_at)
                values (?, ?, 1, 'SUCCESS', cast(? as jsonb), cast(? as jsonb), cast(? as jsonb), current_timestamp, current_timestamp)
                """, attemptId, nodeExecutionId, "{\"apiKey\":\"" + secret + "\"}",
                "{\"deep\":{\"Authorization\":\"Bearer " + secret + "\",\"value\":true}}",
                "{\"nested\":[{\"password\":\"" + secret + "\"}]}");
        jdbc.update("update workflow.node_executions set status='SUCCESS', attempt_count=1, output=cast(? as jsonb), error=cast(? as jsonb) where id = ?",
                "{\"deep\":{\"apiKey\":\"" + secret + "\",\"safe\":\"ok\"}}",
                "{\"nested\":[{\"token\":\"" + secret + "\"}]}", nodeExecutionId);
        jdbc.update("""
                insert into workflow.execution_logs
                    (id, execution_id, node_execution_id, attempt_id, level, event_type, message, metadata, created_at)
                values (?, ?, ?, ?, 'INFO', 'provider.response', ?, cast(? as jsonb), current_timestamp)
                """, UUID.randomUUID(), executionId, nodeExecutionId, attemptId,
                "authorization=Bearer " + secret,
                "{\"headers\":{\"authorization\":\"Bearer " + secret + "\"},\"safe\":\"visible\"}");

        MvcResult result = mockMvc.perform(get("/workspaces/{workspaceId}/workflows/{workflowId}/executions/{executionId}"
                                + "?logPage=0&logSize=1", workspaceId, workflowId, executionId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.executionId").value(executionId.toString()))
                .andExpect(jsonPath("$.nodes[0].attempts[0].attemptNumber").value(1))
                .andExpect(jsonPath("$.logs.page").value(0))
                .andExpect(jsonPath("$.logs.size").value(1))
                .andExpect(jsonPath("$.logs.totalElements").value(1))
                .andExpect(jsonPath("$.logs.hasNext").value(false))
                .andReturn();

        String response = result.getResponse().getContentAsString();
        assertFalse(response.contains(secret));
        assertFalse(response.toLowerCase().contains("apikey"));
        assertFalse(response.toLowerCase().contains("authorization"));
        assertFalse(response.toLowerCase().contains("password"));
        assertTrue(response.contains("visible"));
    }

    @Test
    void rejectsInvalidPathAndPaginationValuesWithStandardErrors() throws Exception {
        UUID workflowId = createPublishedWorkflow("validation-root");
        mockMvc.perform(get("/workspaces/{workspaceId}/workflows/{workflowId}/executions?page=0&size=101",
                                workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
        mockMvc.perform(get("/workspaces/{workspaceId}/workflows/{workflowId}/executions/not-a-uuid",
                                workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));
    }

    private UUID createPublishedWorkflow(String rootId) {
        Workflow draft = workflowDraftService.create(new CreateWorkflowCommand(
                workspaceId, USER_ID, "Execution HTTP test", null));
        workflowDraftService.save(workspaceId, draft.getId(), USER_ID, draft.getName(), draft.getDescription(),
                new com.weav.workflow.domain.definition.WorkflowDefinition("1.0",
                        List.of(new com.weav.workflow.domain.definition.WorkflowDefinition.Node(
                                rootId, "trigger.manual", Map.of())), List.of(), Map.of()), Map.of());
        workflowPublicationService.publish(workspaceId, draft.getId(), USER_ID);
        Workflow published = workflowRepository.findByWorkspaceAndId(workspaceId, draft.getId()).orElseThrow();
        assertEquals(WorkflowStatus.PUBLISHED, published.getStatus());
        return published.getId();
    }

    private UUID admit(UUID workflowId, String marker) throws Exception {
        MvcResult result = mockMvc.perform(post("/workspaces/{workspaceId}/workflows/{workflowId}/executions",
                                workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"input\":{\"marker\":\"" + marker + "\"}}"))
                .andExpect(status().isAccepted())
                .andReturn();
        return UUID.fromString(objectMapper.readTree(result.getResponse().getContentAsString())
                .path("executionId").stringValue());
    }

    private int count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Integer.class, args);
    }

    private String scalar(String sql, Object... args) {
        return jdbc.queryForObject(sql, String.class, args);
    }

    private UUID jdbcUuid(String sql, Object... args) {
        return jdbc.queryForObject(sql, UUID.class, args);
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
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(objectMapper.writeValueAsBytes(value));
    }
}
