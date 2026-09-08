package com.weav.identity.presentation.http;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.presentation.http.response.TokenResponse;
import com.weav.identity.presentation.http.response.UserResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
@Import(TestcontainersConfiguration.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD)
class OtpRecoveryHttpIntegrationTest {

    private static final String OLD_PASSWORD = "correct-horse-battery-staple";
    private static final String NEW_PASSWORD = "replacement-horse-battery-staple";
    private static final String CHANGED_PASSWORD = "changed-horse-battery-staple";
    private static final String HMAC_SECRET = "identity-test-hmac-secret-012345678901234567890123";

    @Container
    static final GenericContainer<?> VALKEY = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine")).withExposedPorts(6379);

    @Container
    static final GenericContainer<?> MAILPIT = new GenericContainer<>(
            DockerImageName.parse("axllent/mailpit:v1.21.8")).withExposedPorts(1025, 8025);

    @LocalServerPort
    private int port;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .build();

    @DynamicPropertySource
    static void dependencies(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.url", () ->
                "redis://" + VALKEY.getHost() + ":" + VALKEY.getMappedPort(6379));
        registry.add("weav.otp.hmac-secret", () -> HMAC_SECRET);
        registry.add("weav.mail.host", MAILPIT::getHost);
        registry.add("weav.mail.port", () -> MAILPIT.getMappedPort(1025));
        registry.add("weav.mail.from", () -> "no-reply@example.test");
        registry.add("weav.mail.auth", () -> false);
        registry.add("weav.mail.start-tls", () -> false);
        registry.add("weav.mail.start-tls-required", () -> false);
        registry.add("weav.mail.ssl", () -> false);
    }

    @Test
    void completesEmailVerificationThenPasswordRecoveryAndRevokesSessions() throws Exception {
        String email = uniqueEmail("recovery");
        register(email, OLD_PASSWORD);
        TokenResponse firstSession = login(email, OLD_PASSWORD);
        TokenResponse secondSession = login(email, OLD_PASSWORD);

        HttpResponse<String> verificationRequest = post(
                "/auth/otp/request", firstSession.accessToken(), Map.of("purpose", "EMAIL_VERIFICATION"));
        assertEquals(202, verificationRequest.statusCode());
        assertEquals("no-store", verificationRequest.headers().firstValue("Cache-Control").orElseThrow());
        JsonNode verificationReceipt = objectMapper.readTree(verificationRequest.body());
        assertReceipt(verificationReceipt);
        String verificationCode = MailCatcherTestSupport.awaitOtpCode(MAILPIT, objectMapper, email);

        HttpResponse<String> verified = post(
                "/auth/otp/verify",
                firstSession.accessToken(),
                Map.of("challengeId", verificationReceipt.get("challengeId").asText(), "code", verificationCode));
        assertEquals(200, verified.statusCode());
        assertEquals("EMAIL_VERIFICATION", objectMapper.readTree(verified.body()).get("purpose").asText());
        assertTrue(objectMapper.readTree(verified.body()).get("verified").asBoolean());

        String resetEmail = uniqueEmail("password-reset");
        UserResponse resetUser = register(resetEmail, OLD_PASSWORD);
        TokenResponse resetFirstSession = login(resetEmail, OLD_PASSWORD);
        TokenResponse resetSecondSession = login(resetEmail, OLD_PASSWORD);
        HttpResponse<String> resetRequest = post(
                "/auth/forgot-password", null, Map.of("email", resetEmail));
        assertEquals(202, resetRequest.statusCode());
        JsonNode resetReceipt = objectMapper.readTree(resetRequest.body());
        assertReceipt(resetReceipt);
        String resetCode = MailCatcherTestSupport.awaitOtpCode(MAILPIT, objectMapper, resetEmail);

        HttpResponse<String> resetVerified = post(
                "/auth/otp/verify", null,
                Map.of("challengeId", resetReceipt.get("challengeId").asText(), "code", resetCode));
        assertEquals(200, resetVerified.statusCode());
        JsonNode resetResult = objectMapper.readTree(resetVerified.body());
        assertEquals("PASSWORD_RESET", resetResult.get("purpose").asText());
        String resetToken = resetResult.get("resetToken").asText();
        assertTrue(resetToken.matches("[A-Za-z0-9_-]{43}"));
        assertEquals(300, resetResult.get("expiresIn").asLong());

        HttpResponse<String> reset = post(
                "/auth/reset-password", null,
                Map.of("resetToken", resetToken, "newPassword", NEW_PASSWORD));
        assertEquals(204, reset.statusCode());
        assertEquals("no-store", reset.headers().firstValue("Cache-Control").orElseThrow());
        assertTrue(reset.body().isEmpty());

        assertEquals(401, get("/users/me", resetFirstSession.accessToken()).statusCode());
        assertEquals(401, get("/users/me", resetSecondSession.accessToken()).statusCode());
        assertEquals(401, post("/auth/refresh", null,
                Map.of("refreshToken", resetFirstSession.refreshToken())).statusCode());
        assertEquals(401, post("/auth/refresh", null,
                Map.of("refreshToken", resetSecondSession.refreshToken())).statusCode());
        assertEquals(401, post("/auth/login", null,
                Map.of("email", resetEmail, "password", OLD_PASSWORD)).statusCode());
        TokenResponse replacement = login(resetEmail, NEW_PASSWORD);
        assertNotEquals(resetFirstSession.accessToken(), replacement.accessToken());
        assertEquals(200, get("/users/me", replacement.accessToken()).statusCode());

        UserResponse current = objectMapper.readValue(
                get("/users/me", replacement.accessToken()).body(), UserResponse.class);
        assertEquals(resetUser.id(), current.id());
        assertTrue(current.emailVerifiedAt() != null);
    }

    @Test
    void enforcesEmailPresenceRulesAndAuthenticatedOwnership() throws Exception {
        String firstEmail = uniqueEmail("owner");
        String secondEmail = uniqueEmail("other");
        register(firstEmail, OLD_PASSWORD);
        register(secondEmail, OLD_PASSWORD);
        TokenResponse firstSession = login(firstEmail, OLD_PASSWORD);
        TokenResponse secondSession = login(secondEmail, OLD_PASSWORD);

        assertEquals(400, postRaw("/auth/otp/request", firstSession.accessToken(),
                "{\"purpose\":\"EMAIL_VERIFICATION\",\"email\":null}").statusCode());
        assertEquals(400, postRaw("/auth/otp/request", firstSession.accessToken(),
                "{\"purpose\":\"EMAIL_VERIFICATION\",\"email\":\"other@example.com\"}").statusCode());

        HttpResponse<String> request = post(
                "/auth/otp/request", firstSession.accessToken(), Map.of("purpose", "EMAIL_VERIFICATION"));
        assertEquals(202, request.statusCode());
        JsonNode receipt = objectMapper.readTree(request.body());
        assertEquals(401, post(
                "/auth/otp/verify", secondSession.accessToken(),
                Map.of("challengeId", receipt.get("challengeId").asText(), "code", "000000")).statusCode());
    }

    @Test
    void publicRecoveryUsesTheSameOpaqueReceiptForUnknownDisabledAndOauthOnlyAccounts() throws Exception {
        String unknown = uniqueEmail("unknown");
        String disabled = uniqueEmail("disabled");
        String oauthOnly = uniqueEmail("oauth-only");

        UserResponse disabledUser = register(disabled, OLD_PASSWORD);
        UserResponse oauthOnlyUser = register(oauthOnly, OLD_PASSWORD);
        jdbcTemplate.update("update identity.users set status = 'DISABLED' where id = ?", disabledUser.id());
        jdbcTemplate.update("update identity.users set password_hash = null where id = ?", oauthOnlyUser.id());

        JsonNode unknownReceipt = acceptedReceipt(unknown);
        JsonNode disabledReceipt = acceptedReceipt(disabled);
        JsonNode oauthOnlyReceipt = acceptedReceipt(oauthOnly);
        assertEquals(unknownReceipt.get("expiresIn").asLong(), disabledReceipt.get("expiresIn").asLong());
        assertEquals(unknownReceipt.get("retryAfter").asLong(), oauthOnlyReceipt.get("retryAfter").asLong());
        assertTrue(unknownReceipt.get("challengeId").asText().matches("[A-Za-z0-9_-]{43}"));
        assertTrue(disabledReceipt.get("challengeId").asText().matches("[A-Za-z0-9_-]{43}"));
        assertTrue(oauthOnlyReceipt.get("challengeId").asText().matches("[A-Za-z0-9_-]{43}"));
    }

    @Test
    void staleCredentialChallengeAndGrantAreRejectedAfterPasswordChange() throws Exception {
        String challengeEmail = uniqueEmail("stale-challenge");
        register(challengeEmail, OLD_PASSWORD);
        TokenResponse challengeSession = login(challengeEmail, OLD_PASSWORD);
        HttpResponse<String> challengeRequest = post(
                "/auth/forgot-password", null, Map.of("email", challengeEmail));
        assertEquals(202, challengeRequest.statusCode());
        JsonNode challengeReceipt = objectMapper.readTree(challengeRequest.body());
        String challengeCode = MailCatcherTestSupport.awaitOtpCode(MAILPIT, objectMapper, challengeEmail);

        assertEquals(204, post("/auth/change-password", challengeSession.accessToken(),
                Map.of("currentPassword", OLD_PASSWORD, "newPassword", CHANGED_PASSWORD)).statusCode());
        assertEquals(400, post("/auth/otp/verify", challengeSession.accessToken(), Map.of(
                "challengeId", challengeReceipt.get("challengeId").asText(), "code", challengeCode
        )).statusCode());

        String grantEmail = uniqueEmail("stale-grant");
        register(grantEmail, OLD_PASSWORD);
        TokenResponse grantSession = login(grantEmail, OLD_PASSWORD);
        HttpResponse<String> grantRequest = post(
                "/auth/forgot-password", null, Map.of("email", grantEmail));
        assertEquals(202, grantRequest.statusCode());
        JsonNode grantReceipt = objectMapper.readTree(grantRequest.body());
        String grantCode = MailCatcherTestSupport.awaitOtpCode(MAILPIT, objectMapper, grantEmail);
        HttpResponse<String> grantVerification = post("/auth/otp/verify", null, Map.of(
                "challengeId", grantReceipt.get("challengeId").asText(), "code", grantCode
        ));
        assertEquals(200, grantVerification.statusCode());
        String resetToken = objectMapper.readTree(grantVerification.body()).get("resetToken").asText();

        assertEquals(204, post("/auth/change-password", grantSession.accessToken(),
                Map.of("currentPassword", OLD_PASSWORD, "newPassword", CHANGED_PASSWORD)).statusCode());
        assertEquals(400, post("/auth/reset-password", null, Map.of(
                "resetToken", resetToken, "newPassword", NEW_PASSWORD
        )).statusCode());
        assertEquals(200, post("/auth/login", null,
                Map.of("email", grantEmail, "password", CHANGED_PASSWORD)).statusCode());
        assertEquals(401, post("/auth/login", null,
                Map.of("email", grantEmail, "password", NEW_PASSWORD)).statusCode());
    }

    private UserResponse register(String email, String password) throws Exception {
        HttpResponse<String> response = post("/auth/register", null,
                Map.of("email", email, "password", password, "displayName", "OTP Test"));
        assertEquals(201, response.statusCode());
        return objectMapper.readValue(response.body(), UserResponse.class);
    }

    private TokenResponse login(String email, String password) throws Exception {
        HttpResponse<String> response = post("/auth/login", null,
                Map.of("email", email, "password", password));
        assertEquals(200, response.statusCode());
        return objectMapper.readValue(response.body(), TokenResponse.class);
    }

    private JsonNode acceptedReceipt(String email) throws Exception {
        HttpResponse<String> response = post("/auth/forgot-password", null, Map.of("email", email));
        assertEquals(202, response.statusCode());
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        JsonNode receipt = objectMapper.readTree(response.body());
        assertReceipt(receipt);
        return receipt;
    }

    private HttpResponse<String> post(String path, String accessToken, Object body) throws Exception {
        return postRaw(path, accessToken, objectMapper.writeValueAsString(body));
    }

    private HttpResponse<String> postRaw(String path, String accessToken, String body) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri(path))
                .timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/json");
        if (accessToken != null) request.header("Authorization", "Bearer " + accessToken);
        return httpClient.send(
                request.POST(HttpRequest.BodyPublishers.ofString(body)).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> get(String path, String accessToken) throws Exception {
        return httpClient.send(
                HttpRequest.newBuilder(uri(path))
                        .timeout(Duration.ofSeconds(10))
                        .header("Authorization", "Bearer " + accessToken)
                        .GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }

    private static void assertReceipt(JsonNode receipt) {
        assertTrue(receipt.get("challengeId").asText().matches("[A-Za-z0-9_-]{43}"));
        assertEquals(300, receipt.get("expiresIn").asLong());
        assertEquals(60, receipt.get("retryAfter").asLong());
        assertFalse(receipt.has("code"));
    }

    private static String uniqueEmail(String prefix) {
        return prefix + "." + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    }
}
