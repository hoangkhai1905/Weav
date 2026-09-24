package com.weav.workflow.presentation.http;

import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.application.service.WorkspaceAuthorization;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.infrastructure.security.JwtProperties;
import com.weav.workflow.infrastructure.web.CorrelationIdFilter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.rabbitmq.RabbitMQContainer;
import org.testcontainers.utility.DockerImageName;
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

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@Import({WorkflowSecurityTest.WorkflowContainersConfiguration.class,
        WorkflowSecurityTest.TestControllerConfiguration.class})
class WorkflowSecurityTest {

    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000001");
    private static final UUID WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID OTHER_WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-000000000099");
    private static final UUID CONNECTION_ID = UUID.fromString("30000000-0000-0000-0000-000000000001");
    private static final String INTERNAL_KEY = "workflow-test-internal-service-key";

    @Autowired
    private WebApplicationContext webApplicationContext;

    @Autowired
    private JwtProperties jwtProperties;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
        objectMapper = new ObjectMapper();
    }

    @Test
    void acceptsAnIdentityAccessJwtAndUsesItsSubjectAsTheActor() throws Exception {
        String token = accessToken(USER_ID.toString(), "access", Instant.now().plusSeconds(120),
                jwtProperties.accessSecret());

        mockMvc.perform(get("/test/security/principal")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.actorId").value(USER_ID.toString()));
    }

    @Test
    void rejectsAValidlySignedJwtWithAMalformedSubject() throws Exception {
        String token = accessToken("not-a-uuid", "access", Instant.now().plusSeconds(120),
                jwtProperties.accessSecret());

        assertUnauthorized(token);
    }

    @Test
    void rejectsAnAccessJwtWithTheWrongSignature() throws Exception {
        String token = accessToken(USER_ID.toString(), "access", Instant.now().plusSeconds(120),
                "wrong-test-key-with-at-least-thirty-two-utf8-bytes");

        assertUnauthorized(token);
    }

    @Test
    void rejectsAnExpiredAccessJwt() throws Exception {
        String token = accessToken(USER_ID.toString(), "access", Instant.now().minusSeconds(60),
                jwtProperties.accessSecret());

        assertUnauthorized(token);
    }

    @Test
    void rejectsARefreshJwtOnPublicRoutes() throws Exception {
        String token = accessToken(USER_ID.toString(), "refresh", Instant.now().plusSeconds(120),
                jwtProperties.accessSecret());

        assertUnauthorized(token);
    }

    @Test
    void rejectsMissingBearerAuthenticationWithTheStructuredCorrelatedError() throws Exception {
        mockMvc.perform(get("/test/security/principal")
                        .header(CorrelationIdFilter.HEADER_NAME, "workflow-security-42"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string(CorrelationIdFilter.HEADER_NAME, "workflow-security-42"))
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"))
                .andExpect(jsonPath("$.error.message").value("Authentication is required"))
                .andExpect(jsonPath("$.status").value(401));
    }

    @Test
    void ignoresAClientSuppliedActorAndUsesTheAuthenticatedJwtSubject() throws Exception {
        UUID attackerId = UUID.fromString("20000000-0000-0000-0000-000000000099");
        String token = accessToken(USER_ID.toString(), "access", Instant.now().plusSeconds(120),
                jwtProperties.accessSecret());

        mockMvc.perform(post("/test/security/actor")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization", "Bearer " + token)
                        .content("{\"userId\":\"" + attackerId + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.actorId").value(USER_ID.toString()));
    }

    @Test
    void missingInternalKeyRejectsTheInternalUsageEndpointBeforeItsController() throws Exception {
        mockMvc.perform(get(internalUsagePath()).servletPath(internalUsagePath()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
    }

    @Test
    void aServiceKeyAloneCanCallOnlyTheInternalUsageBoundary() throws Exception {
        mockMvc.perform(get(internalUsagePath())
                        .servletPath(internalUsagePath())
                        .header("X-Internal-Service-Key", INTERNAL_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inUse").value(false));

        mockMvc.perform(get("/test/security/principal")
                        .header("X-Internal-Service-Key", INTERNAL_KEY))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void serviceKeyDoesNotBypassJwtOnOtherMethodsOrPaths() throws Exception {
        mockMvc.perform(post(internalUsagePath())
                        .servletPath(internalUsagePath())
                        .header("X-Internal-Service-Key", INTERNAL_KEY))
                .andExpect(status().isUnauthorized());

        String nestedPath = internalUsagePath() + "/extra";
        mockMvc.perform(get(nestedPath)
                        .servletPath(nestedPath)
                        .header("X-Internal-Service-Key", INTERNAL_KEY))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void onlyPostToOneWebhookPathSegmentBypassesPublicJwt() throws Exception {
        String endpointKey = "unknown-" + UUID.randomUUID();
        String webhookPath = "/webhooks/" + endpointKey;

        mockMvc.perform(post(webhookPath)
                        .servletPath(webhookPath)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isNotFound())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.error.code").value("WEBHOOK_NOT_FOUND"))
                .andExpect(jsonPath("$.error.message").value("Webhook was not found"));

        mockMvc.perform(get("/webhooks/test-endpoint")
                        .servletPath("/webhooks/test-endpoint"))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/webhooks/test-endpoint/extra")
                        .servletPath("/webhooks/test-endpoint/extra"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aBearerTokenAloneCannotCallTheInternalUsageEndpoint() throws Exception {
        String token = accessToken(USER_ID.toString(), "access", Instant.now().plusSeconds(120),
                jwtProperties.accessSecret());

        mockMvc.perform(get(internalUsagePath())
                        .servletPath(internalUsagePath())
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void accessErrorDoesNotEchoRequestBodyOrTokenMaterial() throws Exception {
        String bodyMarker = "client-body-secret-marker";

        var response = mockMvc.perform(post("/test/security/actor")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(CorrelationIdFilter.HEADER_NAME, "unsafe correlation value")
                        .content("{\"apiKey\":\"" + bodyMarker + "\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().exists(CorrelationIdFilter.HEADER_NAME))
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"))
                .andReturn();
        String body = response.getResponse().getContentAsString();
        String echoedCorrelationId = response.getResponse().getHeader(CorrelationIdFilter.HEADER_NAME);

        org.junit.jupiter.api.Assertions.assertFalse(body.contains(bodyMarker));
        org.junit.jupiter.api.Assertions.assertFalse(body.contains(INTERNAL_KEY));
        org.junit.jupiter.api.Assertions.assertNotEquals("unsafe correlation value", echoedCorrelationId);
        org.junit.jupiter.api.Assertions.assertTrue(echoedCorrelationId.matches("[A-Za-z0-9._:-]{1,128}"));
    }

    @Test
    void editCapabilityDoesNotGrantPublish() {
        WorkspaceAccessPort access = (workspace, user) -> new WorkspaceAccessPort.Access(
                workspace, user, "MEMBER", Set.of("WORKSPACE_VIEW", "WORKFLOW_EDIT"));
        WorkspaceAuthorization authorization = new WorkspaceAuthorization(access);

        assertThrows(ForbiddenException.class,
                () -> authorization.require(WORKSPACE_ID, USER_ID, "WORKFLOW_PUBLISH"));
    }

    @Test
    void ownerAuthorizationUsesOnlyCapabilitiesReturnedByWorkspace() {
        WorkspaceAccessPort access = (workspace, user) -> new WorkspaceAccessPort.Access(
                workspace, user, "OWNER", Set.of("WORKSPACE_VIEW", "WORKFLOW_PUBLISH"));
        WorkspaceAuthorization authorization = new WorkspaceAuthorization(access);

        assertDoesNotThrow(() -> authorization.require(WORKSPACE_ID, USER_ID, "WORKFLOW_PUBLISH"));
        assertThrows(ForbiddenException.class,
                () -> authorization.require(WORKSPACE_ID, USER_ID, "WORKFLOW_MANAGE_STATE"));
    }

    @Test
    void unknownFutureWorkspaceCapabilitiesDoNotPreventKnownCapabilityChecks() {
        WorkspaceAccessPort access = (workspace, user) -> new WorkspaceAccessPort.Access(
                workspace, user, "MEMBER", Set.of("WORKSPACE_VIEW", "FUTURE_WORKFLOW_ADMIN"));

        assertDoesNotThrow(() -> new WorkspaceAuthorization(access)
                .require(WORKSPACE_ID, USER_ID, "WORKSPACE_VIEW"));
    }

    @Test
    void mismatchedWorkspaceAccessIsRejectedAsAServiceFailure() {
        WorkspaceAccessPort access = (workspace, user) -> new WorkspaceAccessPort.Access(
                OTHER_WORKSPACE_ID, user, "OWNER", Set.of("WORKFLOW_PUBLISH"));

        assertThrows(WorkspaceDependencyUnavailableException.class,
                () -> new WorkspaceAuthorization(access).require(WORKSPACE_ID, USER_ID, "WORKFLOW_PUBLISH"));
    }

    private void assertUnauthorized(String token) throws Exception {
        mockMvc.perform(get("/test/security/principal")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
    }

    private String internalUsagePath() {
        return "/internal/workspaces/" + WORKSPACE_ID + "/connections/" + CONNECTION_ID + "/usage";
    }

    private String accessToken(String subject, String tokenUse, Instant expiresAt, String secret) throws Exception {
        Instant now = Instant.now();
        Map<String, Object> header = Map.of("alg", "HS256", "typ", "JWT");
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("iss", "weav-identity");
        claims.put("sub", subject);
        claims.put("aud", List.of("weav-api"));
        claims.put("iat", now.getEpochSecond());
        claims.put("nbf", now.getEpochSecond());
        claims.put("exp", expiresAt.getEpochSecond());
        claims.put("jti", UUID.randomUUID().toString());
        claims.put("sid", UUID.randomUUID().toString());
        claims.put("system_role", "USER");
        claims.put("user_status", "ACTIVE");
        claims.put("token_use", tokenUse);
        String encodedHeader = encodeJson(header);
        String encodedClaims = encodeJson(claims);
        String signingInput = encodedHeader + "." + encodedClaims;
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String signature = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(mac.doFinal(signingInput.getBytes(StandardCharsets.UTF_8)));
        return signingInput + "." + signature;
    }

    private String encodeJson(Object value) throws Exception {
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(objectMapper.writeValueAsBytes(value));
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TestControllerConfiguration {

        @Bean
        TestSecurityController workflowSecurityTestController() {
            return new TestSecurityController();
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class WorkflowContainersConfiguration {

        @Bean
        @ServiceConnection
        PostgreSQLContainer postgresContainer() {
            return new PostgreSQLContainer(DockerImageName.parse("postgres:latest"));
        }

        @Bean
        @ServiceConnection
        RabbitMQContainer rabbitContainer() {
            return new RabbitMQContainer(DockerImageName.parse("rabbitmq:latest"));
        }
    }

    @RestController
    static class TestSecurityController {

        @GetMapping("/test/security/principal")
        Map<String, String> principal(@AuthenticationPrincipal Jwt jwt) {
            return Map.of("actorId", jwt.getSubject());
        }

        @PostMapping("/test/security/actor")
        Map<String, String> actor(
                @AuthenticationPrincipal Jwt jwt,
                @RequestBody Map<String, Object> ignoredRequest) {
            return Map.of("actorId", jwt.getSubject());
        }
    }
}
