package com.weav.workflow.presentation.http;

import com.weav.workflow.WorkflowDraftTestConfiguration;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.infrastructure.web.CorrelationIdFilter;
import com.weav.workflow.infrastructure.web.WorkflowRequestBodyLimitFilter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.ObjectMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@Import(WorkflowDraftTestConfiguration.class)
class WorkflowDraftHttpTest {

    private static final String TEST_SECRET = "workflow-test-access-secret-with-at-least-32-utf8-bytes";
    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000051");

    @Autowired
    private WebApplicationContext webApplicationContext;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private WorkflowRepository workflowRepository;

    @Autowired
    private WorkflowDraftTestConfiguration.DraftWorkspaceBoundary workspaceBoundary;

    @Autowired
    private WorkflowRequestBodyLimitFilter requestBodyLimitFilter;

    private UUID workspaceId;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        workspaceBoundary.reset();
        workspaceId = UUID.randomUUID();
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .addFilters(requestBodyLimitFilter)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
    }

    @Test
    void createsAndReadsDraftUsingVerifiedPrincipalAndServerSeededManualTrigger() throws Exception {
        MvcResult created = mockMvc.perform(post("/workspaces/{workspaceId}/workflows", workspaceId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Daily report\",\"description\":\"Team\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.workflowId").isNotEmpty())
                .andReturn();

        UUID workflowId = UUID.fromString(objectMapper.readTree(created.getResponse().getContentAsString())
                .path("workflowId").stringValue());
        Workflow persisted = workflowRepository.findByWorkspaceAndId(workspaceId, workflowId).orElseThrow();
        assertEquals(USER_ID, persisted.getCreatedBy(), "the actor must come from the verified JWT subject");
        assertEquals("Team", persisted.getDescription());
        assertNull(persisted.getEditorState());

        mockMvc.perform(get("/workspaces/{workspaceId}/workflows/{workflowId}", workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.workflowId").value(workflowId.toString()))
                .andExpect(jsonPath("$.name").value("Daily report"))
                .andExpect(jsonPath("$.description").value("Team"))
                .andExpect(jsonPath("$.schemaVersion").value("1.0"))
                .andExpect(jsonPath("$.definition.nodes.length()").value(1))
                .andExpect(jsonPath("$.definition.nodes[0].id").value("manual"))
                .andExpect(jsonPath("$.definition.nodes[0].type").value("trigger.manual"))
                .andExpect(jsonPath("$.definition.nodes[0].config").isEmpty())
                .andExpect(jsonPath("$.definition.edges.length()").value(0))
                .andExpect(jsonPath("$.definition.variables").isEmpty());
    }

    @Test
    void savesEditorStateSeparatelyAndAuthorizesEachLiteralConnectionReference() throws Exception {
        UUID workflowId = createDraft("Editable draft");
        UUID connectionId = UUID.fromString("30000000-0000-0000-0000-000000000051");

        mockMvc.perform(put("/workspaces/{workspaceId}/workflows/{workflowId}/draft", workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(saveBody("Saved draft", connectionId, "{\"viewport\":{\"zoom\":2},\"selected\":null}")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Saved draft"))
                .andExpect(jsonPath("$.definition.nodes[1].config.connectionId").value(connectionId.toString()))
                .andExpect(jsonPath("$.editorState.viewport.zoom").value(2))
                .andExpect(jsonPath("$.editorState.selected").value(org.hamcrest.Matchers.nullValue()));

        assertTrue(workspaceBoundary.authorizedConnections().contains(connectionId));
        Workflow persisted = workflowRepository.findByWorkspaceAndId(workspaceId, workflowId).orElseThrow();
        assertEquals("Saved draft", persisted.getName());
        assertEquals(connectionId.toString(), connectionFrom(persisted.getDraftDefinition()));
        assertTrue(persisted.getEditorState().containsKey("selected"));
        assertNull(persisted.getEditorState().get("selected"));
    }

    @Test
    void aCredentialBearingDraftIsRejectedWithoutPersistingItsUnsafeValue() throws Exception {
        UUID workflowId = createDraft("Safe draft");
        Workflow before = workflowRepository.findByWorkspaceAndId(workspaceId, workflowId).orElseThrow();
        UUID connectionId = UUID.fromString("30000000-0000-0000-0000-000000000052");
        String unsafeMarker = "must-not-persist-credential-marker";
        String body = "{\"name\":\"Unsafe draft\",\"description\":\"Rejected\","
                + "\"definition\":{\"schemaVersion\":\"1.0\",\"nodes\":["
                + "{\"id\":\"manual\",\"type\":\"trigger.manual\",\"config\":{}},"
                + "{\"id\":\"sheets\",\"type\":\"google.sheets\",\"config\":{\"connectionId\":\""
                + connectionId + "\",\"apiKey\":\"" + unsafeMarker
                + "\"}}],\"edges\":[],\"variables\":{}},\"editorState\":{}}";

        MvcResult rejected = mockMvc.perform(put("/workspaces/{workspaceId}/workflows/{workflowId}/draft",
                                workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andReturn();

        assertFalse(rejected.getResponse().getContentAsString().contains(unsafeMarker));
        assertTrue(rejected.getResponse().getContentAsString().contains("CREDENTIAL_FIELD_NOT_ALLOWED"));
        Workflow after = workflowRepository.findByWorkspaceAndId(workspaceId, workflowId).orElseThrow();
        assertEquals(before.getName(), after.getName());
        assertEquals(before.getDraftDefinition(), after.getDraftDefinition());
        assertFalse(workspaceBoundary.authorizedConnections().contains(connectionId));
    }

    @Test
    void aCredentialBearingEditorStateIsRejectedWithoutPersistingOrReturningItsUnsafeValue() throws Exception {
        UUID workflowId = createDraft("Safe editor state");
        Workflow before = workflowRepository.findByWorkspaceAndId(workspaceId, workflowId).orElseThrow();
        String unsafeMarker = "editor-state-secret-marker";
        String body = "{\"name\":\"Unsafe editor state\",\"description\":\"Rejected\","
                + "\"definition\":{\"schemaVersion\":\"1.0\",\"nodes\":["
                + "{\"id\":\"manual\",\"type\":\"trigger.manual\",\"config\":{}}],"
                + "\"edges\":[],\"variables\":{}},"
                + "\"editorState\":{\"viewport\":{\"zoom\":2},"
                + "\"panels\":[{\"ApI_Key\":\"" + unsafeMarker + "\"}]}}";

        MvcResult rejected = mockMvc.perform(put("/workspaces/{workspaceId}/workflows/{workflowId}/draft",
                                workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.details[0].field").value("editorState"))
                .andReturn();

        assertFalse(rejected.getResponse().getContentAsString().contains(unsafeMarker));
        Workflow after = workflowRepository.findByWorkspaceAndId(workspaceId, workflowId).orElseThrow();
        assertEquals(before.getName(), after.getName());
        assertEquals(before.getDraftDefinition(), after.getDraftDefinition());
        assertFalse(objectMapper.writeValueAsString(after.getEditorState()).contains(unsafeMarker));

        MvcResult fetched = mockMvc.perform(get("/workspaces/{workspaceId}/workflows/{workflowId}",
                                workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk())
                .andReturn();
        assertFalse(fetched.getResponse().getContentAsString().contains(unsafeMarker));
    }

    @Test
    void deniedConnectionAttachmentDoesNotChangeAnExistingDraft() throws Exception {
        UUID workflowId = createDraft("Still safe");
        UUID connectionId = UUID.fromString("30000000-0000-0000-0000-000000000053");
        workspaceBoundary.denyConnections(Set.of(connectionId));

        mockMvc.perform(put("/workspaces/{workspaceId}/workflows/{workflowId}/draft", workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(saveBody("Should not save", connectionId, "{}")))
                .andExpect(status().isForbidden());

        Workflow persisted = workflowRepository.findByWorkspaceAndId(workspaceId, workflowId).orElseThrow();
        assertEquals("Still safe", persisted.getName());
        assertEquals("manual", nodeId(persisted.getDraftDefinition(), 0));
    }

    @Test
    void missingCapabilityAndCrossWorkspaceIdentifiersAreRejected() throws Exception {
        workspaceBoundary.setCapabilities(Set.of("WORKSPACE_VIEW"));
        mockMvc.perform(post("/workspaces/{workspaceId}/workflows", workspaceId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"No permission\",\"description\":null}"))
                .andExpect(status().isForbidden());

        workspaceBoundary.setCapabilities(Set.of("WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT"));
        UUID workflowId = createDraft("Private draft");
        UUID otherWorkspace = UUID.randomUUID();

        workspaceBoundary.setCapabilities(Set.of("WORKSPACE_VIEW", "WORKFLOW_CREATE"));
        mockMvc.perform(put("/workspaces/{workspaceId}/workflows/{workflowId}/draft", workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Denied edit\",\"description\":null,"
                                + "\"definition\":{\"schemaVersion\":\"1.0\",\"nodes\":["
                                + "{\"id\":\"manual\",\"type\":\"trigger.manual\",\"config\":{}}],"
                                + "\"edges\":[],\"variables\":{}},\"editorState\":{}}"))
                .andExpect(status().isForbidden());
        workspaceBoundary.setCapabilities(Set.of("WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT"));

        mockMvc.perform(get("/workspaces/{workspaceId}/workflows/{workflowId}", otherWorkspace, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isNotFound());

        UUID connectionId = UUID.fromString("30000000-0000-0000-0000-000000000054");
        mockMvc.perform(put("/workspaces/{workspaceId}/workflows/{workflowId}/draft", otherWorkspace, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(saveBody("Cross-workspace write", connectionId, "{}")))
                .andExpect(status().isNotFound());
        assertFalse(workspaceBoundary.authorizedConnections().contains(connectionId));
    }

    @Test
    void listUsesBoundedPaginationAndMalformedOrInvalidBodiesAreRejected() throws Exception {
        createDraft("Page A");
        createDraft("Page B");
        createDraft("Page C");

        mockMvc.perform(get("/workspaces/{workspaceId}/workflows?page=0&size=2", workspaceId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(2))
                .andExpect(jsonPath("$.totalElements").value(3));

        mockMvc.perform(get("/workspaces/{workspaceId}/workflows?page=0&size=101", workspaceId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isBadRequest());

        mockMvc.perform(post("/workspaces/{workspaceId}/workflows", workspaceId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\" \"}"))
                .andExpect(status().isBadRequest());

        mockMvc.perform(post("/workspaces/{workspaceId}/workflows", workspaceId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("MALFORMED_REQUEST"));
    }

    @Test
    void rejectsRequestsWithoutAccessTokenAndReturnsCorrelationIdForDraftErrors() throws Exception {
        MvcResult unauthorized = mockMvc.perform(post("/workspaces/{workspaceId}/workflows", workspaceId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Unauthenticated\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.header()
                        .exists(CorrelationIdFilter.HEADER_NAME))
                .andReturn();
        assertNotNull(unauthorized.getResponse().getHeader(CorrelationIdFilter.HEADER_NAME));
    }

    @Test
    void rejectsAnOversizedDraftRequestBeforePersistingAnyPartOfIt() throws Exception {
        UUID workflowId = createDraft("Size bounded");
        String largeValue = "x".repeat(1_048_576);
        String oversizedBody = "{\"name\":\"Oversized\",\"description\":\"rejected\","
                + "\"definition\":{\"schemaVersion\":\"1.0\",\"nodes\":["
                + "{\"id\":\"manual\",\"type\":\"trigger.manual\",\"config\":{}}],"
                + "\"edges\":[],\"variables\":{\"padding\":\"" + largeValue
                + "\"}},\"editorState\":{}}";

        MvcResult rejected = mockMvc.perform(put("/workspaces/{workspaceId}/workflows/{workflowId}/draft",
                                workspaceId, workflowId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(oversizedBody))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.error.code").value("REQUEST_TOO_LARGE"))
                .andReturn();

        assertFalse(rejected.getResponse().getContentAsString().contains(largeValue));
        Workflow persisted = workflowRepository.findByWorkspaceAndId(workspaceId, workflowId).orElseThrow();
        assertEquals("Size bounded", persisted.getName());
        assertEquals("manual", nodeId(persisted.getDraftDefinition(), 0));
    }

    private UUID createDraft(String name) throws Exception {
        MvcResult result = mockMvc.perform(post("/workspaces/{workspaceId}/workflows", workspaceId)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", name, "description", "created by test"))))
                .andExpect(status().isCreated())
                .andReturn();
        return UUID.fromString(objectMapper.readTree(result.getResponse().getContentAsString())
                .path("workflowId").stringValue());
    }

    private static String saveBody(String name, UUID connectionId, String editorState) {
        return "{\"name\":\"" + name + "\",\"description\":\"edited\","
                + "\"definition\":{\"schemaVersion\":\"1.0\",\"nodes\":["
                + "{\"id\":\"manual\",\"type\":\"trigger.manual\",\"config\":{}},"
                + "{\"id\":\"sheets\",\"type\":\"google.sheets\",\"config\":{\"connectionId\":\""
                + connectionId + "\"}}],\"edges\":[],\"variables\":{}},\"editorState\":"
                + editorState + "}";
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

    private String connectionFrom(Map<String, Object> definition) {
        List<?> nodes = (List<?>) definition.get("nodes");
        Map<?, ?> node = (Map<?, ?>) nodes.get(1);
        Map<?, ?> config = (Map<?, ?>) node.get("config");
        return (String) config.get("connectionId");
    }

    private String nodeId(Map<String, Object> definition, int index) {
        List<?> nodes = (List<?>) definition.get("nodes");
        return (String) ((Map<?, ?>) nodes.get(index)).get("id");
    }
}
