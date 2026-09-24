package com.weav.workflow.presentation.http;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowVersion;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.application.port.out.WorkflowVersionPort;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Verifies publication and lifecycle behavior through the real JWT decoder and HTTP controllers. */
@SpringBootTest
@Import(WorkflowPublicationTestConfiguration.class)
class WorkflowPublicationHttpTest {

    private static final String TEST_SECRET = "workflow-test-access-secret-with-at-least-32-utf8-bytes";
    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000071");

    @Autowired
    private WebApplicationContext webApplicationContext;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private WorkflowRepository workflows;
    @Autowired
    private WorkflowVersionPort versions;
    @Autowired
    private WorkflowPublicationTestConfiguration.PublicationWorkspaceAccess workspaceAccess;
    @Autowired
    private WorkflowRequestBodyLimitFilter bodyLimitFilter;

    private UUID workspaceId;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        workspaceId = UUID.randomUUID();
        workspaceAccess.reset();
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .addFilters(bodyLimitFilter)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
    }

    @Test
    void signedJwtPublishesPausesRepublishesWithoutResumingAndResumesExplicitly() throws Exception {
        Workflow workflow = createDraft("Lifecycle workflow");

        MvcResult initial = mockMvc.perform(post(path(workflow, "publish"))
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(header().exists(CorrelationIdFilter.HEADER_NAME))
                .andExpect(jsonPath("$.workflowId").value(workflow.getId().toString()))
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.status").value("PUBLISHED"))
                .andExpect(jsonPath("$.webhooks.length()").value(0))
                .andReturn();
        UUID firstVersionId = UUID.fromString(objectMapper.readTree(initial.getResponse().getContentAsString())
                .path("versionId").stringValue());
        WorkflowVersion firstVersion = versions.require(firstVersionId);
        assertEquals(USER_ID, firstVersion.getPublishedBy(), "publishedBy must come from the verified JWT subject");

        mockMvc.perform(post(path(workflow, "pause"))
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PAUSED"))
                .andExpect(jsonPath("$.currentVersionId").value(firstVersionId.toString()));

        MvcResult republished = mockMvc.perform(post(path(workflow, "publish"))
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.status").value("PAUSED"))
                .andExpect(jsonPath("$.webhooks.length()").value(0))
                .andReturn();
        UUID secondVersionId = UUID.fromString(objectMapper.readTree(republished.getResponse().getContentAsString())
                .path("versionId").stringValue());

        mockMvc.perform(post(path(workflow, "pause"))
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PAUSED"));
        mockMvc.perform(post(path(workflow, "resume"))
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PUBLISHED"))
                .andExpect(jsonPath("$.currentVersionId").value(secondVersionId.toString()));
        mockMvc.perform(post(path(workflow, "resume"))
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PUBLISHED"));
    }

    @Test
    void workspaceCapabilitiesGatePublishAndStateChanges() throws Exception {
        Workflow workflow = createDraft("Capability workflow");
        workspaceAccess.setCapabilities(Set.of("WORKSPACE_VIEW"));

        mockMvc.perform(post(path(workflow, "publish"))
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        assertEquals(WorkflowStatus.DRAFT,
                workflows.findByWorkspaceAndId(workspaceId, workflow.getId()).orElseThrow().getStatus());

        workspaceAccess.setCapabilities(Set.of("WORKSPACE_VIEW", "WORKFLOW_PUBLISH"));
        mockMvc.perform(post(path(workflow, "publish"))
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk());

        workspaceAccess.setCapabilities(Set.of("WORKSPACE_VIEW", "WORKFLOW_PUBLISH"));
        mockMvc.perform(post(path(workflow, "pause"))
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isForbidden());
    }

    @Test
    void webhookPublicationReturnsOneTimeSecretWithNoStoreAndGetNeverReturnsCredentials() throws Exception {
        Workflow workflow = createDraft("Webhook gate");
        workflow.updateDraft(workflow.getName(), workflow.getDescription(), webhookDefinition(), Map.of());
        workflows.save(workflow);

        MvcResult published = mockMvc.perform(post(path(workflow, "publish"))
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.webhooks.length()").value(1))
                .andReturn();

        var issued = objectMapper.readTree(published.getResponse().getContentAsString()).path("webhooks").get(0);
        String endpointKey = issued.path("endpointKey").stringValue();
        String secret = issued.path("secret").stringValue();
        assertFalse(endpointKey.isBlank());
        assertFalse(secret.isBlank());

        String laterRead = mockMvc.perform(get("/workspaces/" + workspaceId + "/workflows/" + workflow.getId())
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.triggers[0].endpointKey").doesNotExist())
                .andExpect(jsonPath("$.triggers[0].secret").doesNotExist())
                .andExpect(jsonPath("$.triggers[0].secretHash").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        assertFalse(laterRead.contains(endpointKey));
        assertFalse(laterRead.contains(secret));
        assertFalse(laterRead.contains("secretHash"));
    }

    @Test
    void getWorkflowShowsPersistedTelegramRegistrationAsDisabledWithSafeReason() throws Exception {
        Workflow workflow = createDraft("Telegram registration");
        workflow.updateDraft(workflow.getName(), workflow.getDescription(), telegramDefinition(), Map.of());
        workflows.save(workflow);

        mockMvc.perform(post(path(workflow, "publish"))
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk());

        mockMvc.perform(get("/workspaces/" + workspaceId + "/workflows/" + workflow.getId())
                        .header("Authorization", "Bearer " + accessToken(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.triggers.length()").value(1))
                .andExpect(jsonPath("$.triggers[0].type").value("TELEGRAM"))
                .andExpect(jsonPath("$.triggers[0].status").value("DISABLED"))
                .andExpect(jsonPath("$.triggers[0].reasonCode").value("DEPENDENCY_NOT_CONFIGURED"))
                .andExpect(jsonPath("$.triggers[0].nextRunAt").value(org.hamcrest.Matchers.nullValue()));
    }

    private Workflow createDraft(String name) {
        return workflows.save(Workflow.createDraft(workspaceId, name, "Description", USER_ID));
    }

    private String path(Workflow workflow, String operation) {
        return "/workspaces/" + workspaceId + "/workflows/" + workflow.getId() + "/" + operation;
    }

    private Map<String, Object> webhookDefinition() {
        Map<String, Object> manual = new LinkedHashMap<>();
        manual.put("id", "manual");
        manual.put("type", "trigger.manual");
        manual.put("config", Map.of());
        Map<String, Object> webhook = new LinkedHashMap<>();
        webhook.put("id", "webhook");
        webhook.put("type", "trigger.webhook");
        webhook.put("config", Map.of());
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("schemaVersion", "1.0");
        definition.put("nodes", List.of(manual, webhook));
        definition.put("edges", List.of());
        definition.put("variables", Map.of());
        return definition;
    }

    private Map<String, Object> telegramDefinition() {
        Map<String, Object> manual = new LinkedHashMap<>();
        manual.put("id", "manual");
        manual.put("type", "trigger.manual");
        manual.put("config", Map.of());
        Map<String, Object> telegram = new LinkedHashMap<>();
        telegram.put("id", "telegram");
        telegram.put("type", "trigger.telegram");
        telegram.put("config", Map.of());
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("schemaVersion", "1.0");
        definition.put("nodes", List.of(manual, telegram));
        definition.put("edges", List.of());
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
