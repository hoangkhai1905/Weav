package com.weav.workflow.presentation.http;

import com.weav.workflow.WorkflowDraftTestConfiguration;
import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.infrastructure.security.JwtProperties;
import com.weav.workflow.infrastructure.web.WorkflowRequestBodyLimitFilter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import tools.jackson.databind.ObjectMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "workflow.connection-usage.requests-per-window=1",
        "workflow.connection-usage.window=1h"
})
@Import(WorkflowDraftTestConfiguration.class)
class WorkflowInternalUsageEmbeddedHttpTest {

    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000071");
    private static final String INTERNAL_KEY = "workflow-test-internal-service-key";

    @Value("${local.server.port}")
    private int port;

    @Autowired
    private JwtProperties jwtProperties;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private WorkflowDraftService workflowDraftService;

    @Autowired
    private WorkflowRepository workflowRepository;

    private final HttpClient httpClient = HttpClient.newHttpClient();

    @Test
    void bearerOnlyHeadIsRejectedBeforeUsageLookupAndDoesNotConsumeTheGetQuota() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID connectionId = UUID.randomUUID();
        URI usageUri = URI.create("http://localhost:" + port + "/internal/workspaces/"
                + workspaceId + "/connections/" + connectionId + "/usage");

        HttpResponse<String> head = httpClient.send(
                HttpRequest.newBuilder(usageUri)
                        .header("Authorization", "Bearer " + accessToken(USER_ID))
                        .method("HEAD", HttpRequest.BodyPublishers.noBody())
                        .build(),
                HttpResponse.BodyHandlers.ofString());

        HttpResponse<String> get = httpClient.send(
                HttpRequest.newBuilder(usageUri)
                        .header("X-Internal-Service-Key", INTERNAL_KEY)
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertAll("usage is a keyed GET-only contract",
                () -> assertEquals(403, head.statusCode(), "HEAD must be rejected before the usage lookup"),
                () -> assertEquals(200, get.statusCode(), "a rejected HEAD must not consume the GET quota"),
                () -> assertFalse(objectMapper.readTree(get.body()).path("inUse").booleanValue()));
    }

    @Test
    void productionHttpChainRejectsMatrixPathWithoutChangingDraft() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        Workflow draft = workflowDraftService.create(new CreateWorkflowCommand(
                workspaceId, USER_ID, "Matrix path guard", "Must stay unchanged"));
        Workflow before = workflowRepository.findByWorkspaceAndId(workspaceId, draft.getId()).orElseThrow();
        String bearerToken = accessToken(USER_ID);
        URI workflowUri = URI.create("http://localhost:" + port + "/workspaces/" + workspaceId
                + "/workflows/" + draft.getId());
        HttpResponse<String> canonicalRead = httpClient.send(
                HttpRequest.newBuilder(workflowUri)
                        .header("Authorization", "Bearer " + bearerToken)
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(200, canonicalRead.statusCode(), "the test bearer must be valid for the canonical route");

        String json = "{\"name\":\"Changed through matrix path\",\"description\":\"Too late\","
                + "\"definition\":{\"schemaVersion\":\"1.0\",\"nodes\":["
                + "{\"id\":\"manual\",\"type\":\"trigger.manual\",\"config\":{}}],"
                + "\"edges\":[],\"variables\":{}},\"editorState\":{}}";
        String oversizedWhitespacePaddedJson = " ".repeat(WorkflowRequestBodyLimitFilter.MAX_REQUEST_BYTES) + json;
        URI draftUri = URI.create("http://localhost:" + port + "/workspaces/" + workspaceId
                + "/workflows/" + draft.getId() + "/draft;probe=1");

        HttpResponse<String> response = httpClient.send(
                HttpRequest.newBuilder(draftUri)
                        .header("Authorization", "Bearer " + bearerToken)
                        .header("Content-Type", "application/json")
                        .PUT(HttpRequest.BodyPublishers.ofString(oversizedWhitespacePaddedJson))
                        .build(),
                HttpResponse.BodyHandlers.ofString());

        assertTrue(response.statusCode() == 400 || response.statusCode() == 401 || response.statusCode() == 413,
                "the real filter chain must reject the matrix request or its raw size, got "
                        + response.statusCode() + " with " + response.body());
        if (response.statusCode() == 401) {
            assertEquals("/error", objectMapper.readTree(response.body()).path("path").stringValue(),
                    "the matrix request must be rejected before the draft handler");
        }
        Workflow after = workflowRepository.findByWorkspaceAndId(workspaceId, draft.getId()).orElseThrow();
        assertEquals(before.getName(), after.getName());
        assertEquals(before.getDraftDefinition(), after.getDraftDefinition());
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
