package com.weav.identity.presentation.http;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.presentation.http.response.TokenResponse;
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
import java.util.concurrent.CompletableFuture;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
@Import(TestcontainersConfiguration.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PasswordRecoveryConcurrencyIntegrationTest {

    private static final String OLD_PASSWORD = "correct-horse-battery-staple";
    private static final String NEW_PASSWORD = "replacement-horse-battery-staple";
    private static final String HMAC_SECRET = "identity-concurrency-hmac-secret-012345678901234567890";

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
    void concurrentVerifyAndResetConsumeEachSecretAtMostOnce() throws Exception {
        String email = "concurrency." + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        post("/auth/register", null, Map.of("email", email, "password", OLD_PASSWORD));
        TokenResponse first = login(email, OLD_PASSWORD);
        TokenResponse second = login(email, OLD_PASSWORD);

        HttpResponse<String> request = post("/auth/forgot-password", null, Map.of("email", email));
        assertEquals(202, request.statusCode());
        JsonNode receipt = objectMapper.readTree(request.body());
        String code = MailCatcherTestSupport.awaitOtpCode(MAILPIT, objectMapper, email);

        String verifyBody = objectMapper.writeValueAsString(Map.of(
                "challengeId", receipt.get("challengeId").asText(), "code", code));
        HttpResponse<String>[] verification = concurrentlyPost("/auth/otp/verify", null, verifyBody);
        assertEquals(1, java.util.Arrays.stream(verification)
                .filter(response -> response.statusCode() == 200).count());
        assertEquals(1, java.util.Arrays.stream(verification)
                .filter(response -> response.statusCode() == 400).count());
        String resetToken = java.util.Arrays.stream(verification)
                .filter(response -> response.statusCode() == 200)
                .findFirst()
                .map(response -> read(response).get("resetToken").asText())
                .orElseThrow();

        String resetBody = objectMapper.writeValueAsString(Map.of(
                "resetToken", resetToken, "newPassword", NEW_PASSWORD));
        HttpResponse<String>[] resets = concurrentlyPost("/auth/reset-password", null, resetBody);
        assertEquals(1, java.util.Arrays.stream(resets)
                .filter(response -> response.statusCode() == 204).count());
        assertEquals(1, java.util.Arrays.stream(resets)
                .filter(response -> response.statusCode() == 400).count());

        assertEquals(401, get("/users/me", first.accessToken()).statusCode());
        assertEquals(401, get("/users/me", second.accessToken()).statusCode());
        assertEquals(401, post("/auth/login", null,
                Map.of("email", email, "password", OLD_PASSWORD)).statusCode());
        assertEquals(200, post("/auth/login", null,
                Map.of("email", email, "password", NEW_PASSWORD)).statusCode());
    }

    @Test
    void concurrentResetAndOldPasswordLoginHaveConsistentFinalState() throws Exception {
        String email = "ordering." + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        post("/auth/register", null, Map.of("email", email, "password", OLD_PASSWORD));

        HttpResponse<String> request = post("/auth/forgot-password", null, Map.of("email", email));
        assertEquals(202, request.statusCode());
        JsonNode receipt = objectMapper.readTree(request.body());
        String code = MailCatcherTestSupport.awaitOtpCode(MAILPIT, objectMapper, email);
        HttpResponse<String> verification = post("/auth/otp/verify", null, Map.of(
                "challengeId", receipt.get("challengeId").asText(), "code", code));
        assertEquals(200, verification.statusCode());
        String resetToken = objectMapper.readTree(verification.body()).get("resetToken").asText();

        CompletableFuture<HttpResponse<String>> reset = httpClient.sendAsync(
                request("/auth/reset-password", null, objectMapper.writeValueAsString(Map.of(
                        "resetToken", resetToken, "newPassword", NEW_PASSWORD))).build(),
                HttpResponse.BodyHandlers.ofString());
        CompletableFuture<HttpResponse<String>> login = httpClient.sendAsync(
                request("/auth/login", null, objectMapper.writeValueAsString(Map.of(
                        "email", email, "password", OLD_PASSWORD))).build(),
                HttpResponse.BodyHandlers.ofString());

        HttpResponse<String> resetResponse = reset.get(15, java.util.concurrent.TimeUnit.SECONDS);
        HttpResponse<String> loginResponse = login.get(15, java.util.concurrent.TimeUnit.SECONDS);
        assertEquals(204, resetResponse.statusCode());
        assertTrue(loginResponse.statusCode() == 200 || loginResponse.statusCode() == 401,
                () -> "unexpected concurrent login status: " + loginResponse.statusCode());
        if (loginResponse.statusCode() == 200) {
            TokenResponse racedSession = objectMapper.readValue(loginResponse.body(), TokenResponse.class);
            assertEquals(401, get("/users/me", racedSession.accessToken()).statusCode());
        }
        assertEquals(401, post("/auth/login", null,
                Map.of("email", email, "password", OLD_PASSWORD)).statusCode());
        assertEquals(200, post("/auth/login", null,
                Map.of("email", email, "password", NEW_PASSWORD)).statusCode());
    }

    @Test
    void databaseRollbackAfterGrantConsumptionDoesNotRestoreOrApplyReset() throws Exception {
        String email = "rollback." + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        post("/auth/register", null, Map.of("email", email, "password", OLD_PASSWORD));

        HttpResponse<String> request = post("/auth/forgot-password", null, Map.of("email", email));
        assertEquals(202, request.statusCode());
        JsonNode receipt = objectMapper.readTree(request.body());
        String code = MailCatcherTestSupport.awaitOtpCode(MAILPIT, objectMapper, email);
        HttpResponse<String> verification = post("/auth/otp/verify", null, Map.of(
                "challengeId", receipt.get("challengeId").asText(), "code", code));
        assertEquals(200, verification.statusCode());
        String resetToken = objectMapper.readTree(verification.body()).get("resetToken").asText();

        jdbcTemplate.execute("""
                CREATE OR REPLACE FUNCTION identity_test_fail_password_reset()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $$
                BEGIN
                    RAISE EXCEPTION 'intentional password reset database failure';
                END;
                $$
                """);
        jdbcTemplate.execute("""
                CREATE TRIGGER identity_test_fail_password_reset_trigger
                BEFORE UPDATE OF password_hash ON identity.users
                FOR EACH ROW EXECUTE FUNCTION identity_test_fail_password_reset()
                """);
        try {
            HttpResponse<String> failedReset = post("/auth/reset-password", null, Map.of(
                    "resetToken", resetToken, "newPassword", NEW_PASSWORD));
            assertEquals(500, failedReset.statusCode());
        } finally {
            jdbcTemplate.execute("DROP TRIGGER IF EXISTS identity_test_fail_password_reset_trigger ON identity.users");
            jdbcTemplate.execute("DROP FUNCTION IF EXISTS identity_test_fail_password_reset()");
        }

        assertEquals(400, post("/auth/reset-password", null, Map.of(
                "resetToken", resetToken, "newPassword", NEW_PASSWORD)).statusCode());
        assertEquals(200, post("/auth/login", null,
                Map.of("email", email, "password", OLD_PASSWORD)).statusCode());
        assertEquals(401, post("/auth/login", null,
                Map.of("email", email, "password", NEW_PASSWORD)).statusCode());
    }

    private TokenResponse login(String email, String password) throws Exception {
        HttpResponse<String> response = post("/auth/login", null,
                Map.of("email", email, "password", password));
        assertEquals(200, response.statusCode());
        return objectMapper.readValue(response.body(), TokenResponse.class);
    }

    @SuppressWarnings("unchecked")
    private HttpResponse<String>[] concurrentlyPost(String path, String token, String body) throws Exception {
        HttpRequest.Builder first = request(path, token, body);
        HttpRequest.Builder second = request(path, token, body);
        CompletableFuture<HttpResponse<String>> left = httpClient.sendAsync(
                first.build(), HttpResponse.BodyHandlers.ofString());
        CompletableFuture<HttpResponse<String>> right = httpClient.sendAsync(
                second.build(), HttpResponse.BodyHandlers.ofString());
        return new HttpResponse[]{
                left.get(15, java.util.concurrent.TimeUnit.SECONDS),
                right.get(15, java.util.concurrent.TimeUnit.SECONDS)
        };
    }

    private HttpResponse<String> post(String path, String token, Object body) throws Exception {
        return httpClient.send(request(path, token, objectMapper.writeValueAsString(body)).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private HttpRequest.Builder request(String path, String token, String body) {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri(path))
                .timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/json");
        if (token != null) request.header("Authorization", "Bearer " + token);
        return request.POST(HttpRequest.BodyPublishers.ofString(body));
    }

    private HttpResponse<String> get(String path, String token) throws Exception {
        return httpClient.send(HttpRequest.newBuilder(uri(path))
                        .timeout(Duration.ofSeconds(10))
                        .header("Authorization", "Bearer " + token).GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private JsonNode read(HttpResponse<String> response) {
        try {
            return objectMapper.readTree(response.body());
        } catch (Exception exception) {
            throw new AssertionError("response was not JSON", exception);
        }
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }
}
