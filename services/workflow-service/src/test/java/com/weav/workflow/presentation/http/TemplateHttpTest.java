package com.weav.workflow.presentation.http;

import com.weav.workflow.WorkflowDraftTestConfiguration;
import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.domain.definition.WorkflowDefinition;
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
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.JsonNode;
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
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Template share/browse/use routes against a real PostgreSQL (Testcontainers). */
@SpringBootTest
@Import(WorkflowDraftTestConfiguration.class)
class TemplateHttpTest {
    private static final UUID OWNER = UUID.fromString("20000000-0000-0000-0000-0000000000a1");
    private static final UUID OTHER = UUID.fromString("20000000-0000-0000-0000-0000000000a2");
    private static final Set<String> ALL = Set.of("WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT",
            "WORKFLOW_PUBLISH", "WORKFLOW_RUN", "WORKFLOW_MONITOR", "WORKFLOW_MANAGE_STATE");

    @Autowired
    private WebApplicationContext webApplicationContext;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private JwtProperties jwtProperties;
    @Autowired
    private WorkflowDraftService drafts;
    @Autowired
    private WorkflowDraftTestConfiguration.DraftWorkspaceBoundary workspaceBoundary;
    @Autowired
    private JdbcTemplate jdbc;

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

    @Test
    void shareBrowseUseAndManageRoundTrip() throws Exception {
        UUID workflowId = workflow("Invoices");

        JsonNode preview = json(send(post(shareUrl(workflowId) + "/preview"), OWNER, "USER", null).andExpect(status().isOk()));
        assertEquals("to", preview.get("removedFields").get(0).get("field").asText());
        assertEquals("Contact sales@acme.vn", preview.get("definition").get("nodes").get(1).get("config")
                .get("body").asText());
        assertEquals("EMAIL", preview.get("warnings").get(0).get("reason").asText());
        assertTrue(preview.get("existing").isNull());
        assertEquals(0, count());

        String body = "{\"name\":\"Invoice mail\",\"description\":\"d\",\"authorName\":\"Khai\",\"visibility\":\"UNLISTED\"}";
        JsonNode created = json(send(put(shareUrl(workflowId)), OWNER, "USER", body).andExpect(status().isCreated()));
        String code = created.get("shareCode").asText();
        String id = created.get("id").asText();
        assertEquals(8, code.length());
        assertTrue(created.get("owned").asBoolean());
        assertFalse(created.get("definition").toString().contains("boss@x.com"));
        assertEquals("trigger.manual", created.get("nodeTypes").get(0).asText());

        JsonNode again = json(send(put(shareUrl(workflowId)),
                OWNER, "USER", body.replace("UNLISTED", "PUBLIC")).andExpect(status().isOk()));
        assertEquals(id, again.get("id").asText());
        assertEquals(code, again.get("shareCode").asText());
        assertEquals("PUBLIC", again.get("visibility").asText());

        // a stranger sees it without the owner-only fields
        JsonNode seen = json(send(get("/templates/" + id), OTHER, "USER", null).andExpect(status().isOk()));
        assertFalse(seen.get("owned").asBoolean());
        assertFalse(seen.has("shareCode"));
        assertFalse(seen.has("workspaceId"));
        assertFalse(seen.has("sourceWorkflowId"));

        String typed = code.substring(0, 4).toLowerCase() + "-" + code.substring(4).toLowerCase();
        assertEquals(id, json(send(get("/templates/by-code/" + typed), OTHER, "USER", null)
                .andExpect(status().isOk())).get("id").asText());

        JsonNode listed = json(send(get("/templates?scope=public&q=INVOICE"), OTHER, "USER", null)
                .andExpect(status().isOk()));
        assertEquals(id, listed.get("items").get(0).get("id").asText());
        assertFalse(listed.get("items").get(0).has("definition"));
        assertEquals(1, json(send(get("/templates?scope=mine"), OWNER, "USER", null)).get("totalElements").asInt());
        assertEquals(0, json(send(get("/templates?scope=mine"), OTHER, "USER", null)).get("totalElements").asInt());

        UUID target = UUID.randomUUID();
        JsonNode used = json(send(post("/templates/" + id + "/use"), OTHER, "USER",
                "{\"workspaceId\":\"" + target + "\",\"name\":\"My copy\"}").andExpect(status().isCreated()));
        Workflow copy = drafts.get(target, UUID.fromString(used.get("workflowId").asText()), OTHER);
        assertEquals("My copy", copy.getName());
        assertEquals("email.send", ((Map<?, ?>) ((List<?>) copy.getDraftDefinition().get("nodes")).get(1)).get("type"));
        assertEquals(1, json(send(get("/templates/" + id), OWNER, "USER", null)).get("usageCount").asInt());

        send(patch("/templates/" + id), OWNER, "USER", "{\"name\":\"Renamed\",\"visibility\":\"PRIVATE\"}")
                .andExpect(status().isOk());
        send(get("/templates/by-code/" + code), OTHER, "USER", null).andExpect(status().isNotFound());

        send(delete("/templates/" + id), OWNER, "USER", null).andExpect(status().isNoContent());
        send(get("/templates/" + id), OWNER, "USER", null).andExpect(status().isNotFound());
        send(post("/templates/" + id + "/use"), OTHER, "USER", "{\"workspaceId\":\"" + target + "\"}")
                .andExpect(status().isNotFound());
    }

    @Test
    void hiddenTemplatesAnswerNotFoundOnEveryRoute() throws Exception {
        UUID workflowId = workflow("Secret");
        String id = json(send(put(shareUrl(workflowId)), OWNER, "USER",
                "{\"name\":\"Team only\",\"visibility\":\"PRIVATE\"}").andExpect(status().isCreated()))
                .get("id").asText();
        workspaceBoundary.setCapabilities(Set.of("WORKSPACE_VIEW", "WORKFLOW_CREATE"));

        send(get("/templates/" + id), OTHER, "USER", null).andExpect(status().isNotFound());
        send(patch("/templates/" + id), OTHER, "USER", "{\"name\":\"x\"}").andExpect(status().isNotFound());
        send(delete("/templates/" + id), OTHER, "USER", null).andExpect(status().isNotFound());
        send(post("/templates/" + id + "/use"), OTHER, "USER", "{\"workspaceId\":\"" + UUID.randomUUID() + "\"}")
                .andExpect(status().isNotFound());
        send(get("/templates?scope=workspace&workspaceId=" + workspaceId), OTHER, "USER", null)
                .andExpect(status().isForbidden());

        workspaceBoundary.setCapabilities(ALL);
        assertEquals(id, json(send(get("/templates?scope=workspace&workspaceId=" + workspaceId), OTHER, "USER", null)
                .andExpect(status().isOk())).get("items").get(0).get("id").asText());
    }

    @Test
    void useWithoutCreateCapabilityIsForbiddenAndNotCounted() throws Exception {
        UUID workflowId = workflow("Counted");
        String id = json(send(put(shareUrl(workflowId)), OWNER, "USER",
                "{\"name\":\"Pub\",\"visibility\":\"PUBLIC\"}").andExpect(status().isCreated())).get("id").asText();
        workspaceBoundary.setCapabilities(Set.of("WORKSPACE_VIEW", "WORKFLOW_MONITOR"));

        send(post("/templates/" + id + "/use"), OTHER, "USER", "{\"workspaceId\":\"" + UUID.randomUUID() + "\"}")
                .andExpect(status().isForbidden());

        assertEquals(0, jdbc.queryForObject("select usage_count from workflow.workflow_templates where id = ?::uuid",
                Integer.class, id));
    }

    @Test
    void adminCanTakeAPublicTemplateDownButNotRenameIt() throws Exception {
        UUID workflowId = workflow("Takedown");
        String id = json(send(put(shareUrl(workflowId)), OWNER, "USER",
                "{\"name\":\"Pub\",\"visibility\":\"PUBLIC\"}").andExpect(status().isCreated())).get("id").asText();

        send(patch("/templates/" + id), OTHER, "ADMIN", "{\"name\":\"Mine now\"}").andExpect(status().isForbidden());
        send(patch("/templates/" + id), OTHER, "USER", "{\"visibility\":\"PRIVATE\"}").andExpect(status().isForbidden());
        JsonNode taken = json(send(patch("/templates/" + id), OTHER, "ADMIN", "{\"visibility\":\"PRIVATE\"}")
                .andExpect(status().isOk()));
        assertEquals("PRIVATE", taken.get("visibility").asText());
    }

    @Test
    void badInputIsRejected() throws Exception {
        UUID workflowId = workflow("Validation");
        String url = shareUrl(workflowId);

        send(put(url), OWNER, "USER", "{\"name\":\" \",\"visibility\":\"PUBLIC\"}").andExpect(status().isBadRequest());
        send(put(url), OWNER, "USER", "{\"name\":\"" + "n".repeat(256) + "\",\"visibility\":\"PUBLIC\"}")
                .andExpect(status().isBadRequest());
        send(put(url), OWNER, "USER", "{\"name\":\"ok\",\"visibility\":\"SECRET\"}").andExpect(status().isBadRequest());
        send(put(url), OWNER, "USER", "{\"name\":\"ok\"}").andExpect(status().isBadRequest());
        send(put(url), OWNER, "USER", "{\"name\":\"ok\",\"visibility\":\"PUBLIC\",\"surprise\":1}")
                .andExpect(status().isBadRequest());
        send(put(url), OWNER, "USER", "{\"name\":\"a\",\"name\":\"b\",\"visibility\":\"PUBLIC\"}")
                .andExpect(status().isBadRequest());
        send(put(url), OWNER, "USER", "{\"name\":\"ok\",\"visibility\":\"PUBLIC\"} {\"x\":1}")
                .andExpect(status().isBadRequest());
        send(put(url), OWNER, "USER", "{\"name\":\"ok\",\"description\":\"" + "d".repeat(20_000)
                + "\",\"visibility\":\"PUBLIC\"}").andExpect(status().isBadRequest());
        send(get("/templates?scope=nope"), OWNER, "USER", null).andExpect(status().isBadRequest());
        send(get("/templates?scope=workspace"), OWNER, "USER", null).andExpect(status().isBadRequest());
        send(get("/templates?size=101"), OWNER, "USER", null).andExpect(status().isBadRequest());
        send(get("/templates/by-code/short"), OWNER, "USER", null).andExpect(status().isNotFound());
        assertEquals(0, count());
    }

    @Test
    void routesNeedAuthentication() throws Exception {
        mockMvc.perform(get("/templates")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/templates/by-code/ABCDEFGH")).andExpect(status().isUnauthorized());
        mockMvc.perform(put(shareUrl(UUID.randomUUID())).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
    }

    // ------------------------------------------------------------------ helpers

    private String shareUrl(UUID workflowId) {
        return "/workspaces/" + workspaceId + "/workflows/" + workflowId + "/template";
    }

    private int count() {
        return jdbc.queryForObject("select count(*) from workflow.workflow_templates where workspace_id = ?",
                Integer.class, workspaceId);
    }

    private UUID workflow(String name) {
        Workflow draft = drafts.create(new CreateWorkflowCommand(workspaceId, OWNER, name, null));
        drafts.save(workspaceId, draft.getId(), OWNER, name, null, new WorkflowDefinition("1.0", List.of(
                new WorkflowDefinition.Node("manual", "trigger.manual", Map.of()),
                new WorkflowDefinition.Node("send_email", "email.send", Map.of(
                        "to", "boss@x.com", "subject", "Hi", "body", "Contact sales@acme.vn"))),
                List.of(new WorkflowDefinition.Edge("e1", "manual", "send_email", null)), Map.of()), Map.of());
        return draft.getId();
    }

    private ResultActions send(MockHttpServletRequestBuilder builder, UUID user, String role, String body)
            throws Exception {
        builder.header("Authorization", bearer(user, role));
        if (body != null) {
            builder.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(builder);
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }

    private String bearer(UUID user, String role) throws Exception {
        Instant now = Instant.now();
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("iss", jwtProperties.issuer());
        claims.put("sub", user.toString());
        claims.put("aud", List.of(jwtProperties.audience()));
        claims.put("iat", now.getEpochSecond());
        claims.put("nbf", now.getEpochSecond());
        claims.put("exp", now.plusSeconds(300).getEpochSecond());
        claims.put("jti", UUID.randomUUID().toString());
        claims.put("sid", UUID.randomUUID().toString());
        claims.put("system_role", role);
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
