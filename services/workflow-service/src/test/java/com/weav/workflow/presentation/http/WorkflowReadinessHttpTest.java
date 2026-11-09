package com.weav.workflow.presentation.http;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import com.weav.workflow.infrastructure.web.WorkflowRequestBodyLimitFilter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.web.servlet.MockMvc;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Readiness endpoint through the real JWT decoder and controllers. */
@SpringBootTest
@Import(WorkflowPublicationTestConfiguration.class)
class WorkflowReadinessHttpTest {

    private static final String TEST_SECRET = "workflow-test-access-secret-with-at-least-32-utf8-bytes";
    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000071");

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
    private WorkflowPublicationTestConfiguration.PublicationWorkspaceConnections connections;

    private UUID workspaceId;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        workspaceId = UUID.randomUUID();
        workspaceAccess.reset();
        connections.reset();
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .addFilters(bodyLimitFilter)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
    }

    @Test
    void readyForPublishableDraft() throws Exception {
        Workflow workflow = createDraft(manualOnly());
        mockMvc.perform(get(path(workflow)).header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ready").value(true))
                .andExpect(jsonPath("$.issues.length()").value(0));
    }

    @Test
    void reportsMissingConnectionOnItsStepWithoutMessage() throws Exception {
        Map<String, Object> mail = node("mail", "email.send", Map.of("to", "a@example.test", "subject", "s", "body", "b"));
        Workflow workflow = createDraft(definition(List.of(node("manual", "trigger.manual", Map.of()), mail),
                List.of(edge("manual", "mail"))));
        mockMvc.perform(get(path(workflow)).header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ready").value(false))
                .andExpect(jsonPath("$.issues[?(@.nodeId == 'mail')].code").isNotEmpty())
                .andExpect(jsonPath("$.issues[0].message").doesNotExist());
    }

    @Test
    void reportsUnauthorizedConnectionAndStillReturns200() throws Exception {
        UUID connectionId = UUID.randomUUID();
        Map<String, Object> request = node("request", "http.request",
                Map.of("method", "GET", "url", "https://example.test", "connectionId", connectionId.toString()));
        Workflow workflow = createDraft(definition(List.of(node("manual", "trigger.manual", Map.of()), request),
                List.of(edge("manual", "request"))));
        connections.deny(Set.of(connectionId));
        mockMvc.perform(get(path(workflow)).header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ready").value(false))
                .andExpect(jsonPath("$.issues[0].nodeId").value("request"))
                .andExpect(jsonPath("$.issues[0].field").value("connectionId"))
                .andExpect(jsonPath("$.issues[0].code").value("CONNECTION_NOT_AUTHORIZED"));
    }

    @Test
    void unknownWorkflowIs404() throws Exception {
        mockMvc.perform(get("/workspaces/" + workspaceId + "/workflows/" + UUID.randomUUID() + "/readiness")
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isNotFound());
    }

    @Test
    void nonMemberIs403AndReadinessKeepsDraftUntouched() throws Exception {
        Workflow workflow = createDraft(manualOnly());
        workspaceAccess.setCapabilities(Set.of());
        mockMvc.perform(get(path(workflow)).header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isForbidden());
        workspaceAccess.reset();
        mockMvc.perform(get(path(workflow)).header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk());
        Workflow after = workflows.findByWorkspaceAndId(workspaceId, workflow.getId()).orElseThrow();
        assertEquals(WorkflowStatus.DRAFT, after.getStatus());
        assertEquals(workflow.getDraftDefinition(), after.getDraftDefinition());
        assertEquals(null, after.getCurrentVersionId());
    }

    private Workflow createDraft(Map<String, Object> definition) {
        Workflow workflow = Workflow.createDraft(workspaceId, "Readiness", "Description", USER_ID);
        workflow.updateDraft(workflow.getName(), workflow.getDescription(), definition, Map.of());
        return workflows.save(workflow);
    }

    private String path(Workflow workflow) {
        return "/workspaces/" + workspaceId + "/workflows/" + workflow.getId() + "/readiness";
    }

    private Map<String, Object> manualOnly() {
        return definition(List.of(node("manual", "trigger.manual", Map.of())), List.of());
    }

    private Map<String, Object> node(String id, String type, Map<String, Object> config) {
        Map<String, Object> node = new LinkedHashMap<>();
        node.put("id", id);
        node.put("type", type);
        node.put("config", config);
        return node;
    }

    private Map<String, Object> edge(String source, String target) {
        Map<String, Object> edge = new LinkedHashMap<>();
        edge.put("id", source + "-" + target);
        edge.put("source", source);
        edge.put("target", target);
        edge.put("sourcePort", null);
        return edge;
    }

    private Map<String, Object> definition(List<Map<String, Object>> nodes, List<Map<String, Object>> edges) {
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("schemaVersion", "1.0");
        definition.put("nodes", nodes);
        definition.put("edges", edges);
        definition.put("variables", Map.of());
        return definition;
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
}
