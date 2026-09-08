package com.weav.identity.presentation.http;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.port.out.AuthMailDispatcher;
import com.weav.identity.application.port.out.AuthMailSender;
import com.weav.identity.domain.exception.DependencyUnavailableException;
import com.weav.identity.presentation.http.response.TokenResponse;
import com.weav.identity.presentation.http.response.UserResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
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
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Real HTTP admission test for the shared asynchronous mail dependency path. */
@Testcontainers
@Import({TestcontainersConfiguration.class, OtpMailAdmissionHttpIntegrationTest.BlockingMailConfiguration.class})
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class OtpMailAdmissionHttpIntegrationTest {

    private static final String PASSWORD = "correct-horse-battery-staple";
    private static final String HMAC_SECRET = "identity-mail-admission-hmac-secret-012345678901234567890";
    private static final CountDownLatch FIRST_MAIL_STARTED = new CountDownLatch(1);
    private static final CountDownLatch RELEASE_MAIL = new CountDownLatch(1);

    @Container
    static final GenericContainer<?> VALKEY = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine")).withExposedPorts(6379);

    @LocalServerPort
    private int port;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private AuthMailDispatcher mailDispatcher;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .build();

    @DynamicPropertySource
    static void dependencies(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.url", () ->
                "redis://" + VALKEY.getHost() + ":" + VALKEY.getMappedPort(6379));
        registry.add("weav.otp.hmac-secret", () -> HMAC_SECRET);
        registry.add("weav.mail.host", () -> "test.invalid");
        registry.add("weav.mail.port", () -> 25);
        registry.add("weav.mail.from", () -> "no-reply@example.test");
        registry.add("weav.mail.auth", () -> false);
        registry.add("weav.mail.start-tls", () -> false);
        registry.add("weav.mail.start-tls-required", () -> false);
        registry.add("weav.mail.ssl", () -> false);
        registry.add("weav.mail.queue-capacity", () -> 1);
        registry.add("weav.mail.core-pool-size", () -> 1);
        registry.add("weav.mail.max-pool-size", () -> 1);
    }

    @Test
    void overloadReturnsCommon503ForEveryAccountCategoryWithoutBlockingCoreAuth() throws Exception {
        String eligibleEmail = uniqueEmail("eligible");
        String disabledEmail = uniqueEmail("disabled");
        String oauthOnlyEmail = uniqueEmail("oauth-only");
        UserResponse eligible = register(eligibleEmail);
        UserResponse disabled = register(disabledEmail);
        UserResponse oauthOnly = register(oauthOnlyEmail);
        jdbcTemplate.update("update identity.users set status = 'DISABLED' where id = ?", disabled.id());
        jdbcTemplate.update("update identity.users set password_hash = null where id = ?", oauthOnly.id());

        // Keep one worker and one queue slot occupied by the same dispatcher
        // used by the HTTP use case. Public account lookup must not happen
        // before this common admission gate.
        AuthMailDispatcher.Lease active = mailDispatcher.reserve();
        AuthMailDispatcher.Lease queued = mailDispatcher.reserve();
        active.dispatch(message(), null);
        queued.dispatch(message(), null);
        assertTrue(FIRST_MAIL_STARTED.await(2, TimeUnit.SECONDS));

        TokenResponse coreSession = login(eligibleEmail, PASSWORD);
        List<String> categories = List.of(
                eligibleEmail,
                uniqueEmail("unknown"),
                disabledEmail,
                oauthOnlyEmail
        );
        try {
            for (String email : categories) {
                long started = System.nanoTime();
                HttpResponse<String> response = post("/auth/forgot-password", null, Map.of("email", email));
                long elapsedMillis = Duration.ofNanos(System.nanoTime() - started).toMillis();
                assertEquals(503, response.statusCode(), "category request should fail at shared admission");
                assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
                assertTrue(elapsedMillis < 1000, "SMTP overload must not block HTTP admission");
                JsonNode error = objectMapper.readTree(response.body()).get("error");
                assertEquals("DEPENDENCY_UNAVAILABLE", error.get("code").asText());
            }
            assertEquals(200, get("/users/me", coreSession.accessToken()).statusCode());
        } finally {
            RELEASE_MAIL.countDown();
        }
    }

    private UserResponse register(String email) throws Exception {
        HttpResponse<String> response = post("/auth/register", null, Map.of(
                "email", email, "password", PASSWORD, "displayName", "Mail admission test"));
        assertEquals(201, response.statusCode());
        return objectMapper.readValue(response.body(), UserResponse.class);
    }

    private TokenResponse login(String email, String password) throws Exception {
        HttpResponse<String> response = post("/auth/login", null,
                Map.of("email", email, "password", password));
        assertEquals(200, response.statusCode());
        return objectMapper.readValue(response.body(), TokenResponse.class);
    }

    private HttpResponse<String> post(String path, String token, Object body) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri(path))
                .timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/json");
        if (token != null) request.header("Authorization", "Bearer " + token);
        return httpClient.send(request.POST(HttpRequest.BodyPublishers.ofString(
                objectMapper.writeValueAsString(body))).build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> get(String path, String token) throws Exception {
        return httpClient.send(HttpRequest.newBuilder(uri(path))
                        .timeout(Duration.ofSeconds(10))
                        .header("Authorization", "Bearer " + token)
                        .GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    private AuthMailSender.Message message() {
        return new AuthMailSender.Message("admission@example.test", "Authentication code", "code");
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }

    private static String uniqueEmail(String prefix) {
        return prefix + "." + java.util.UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class BlockingMailConfiguration {

        @Bean
        @Primary
        AuthMailSender blockingAuthMailSender() {
            return message -> {
                FIRST_MAIL_STARTED.countDown();
                try {
                    RELEASE_MAIL.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                }
                throw new DependencyUnavailableException();
            };
        }
    }
}
