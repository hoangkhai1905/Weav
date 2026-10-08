package com.weav.identity.presentation.http;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.dto.OAuthConfiguration;
import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OAuthProviderClient;
import com.weav.identity.application.validation.OAuthProtocolPolicy;
import com.weav.identity.infrastructure.security.oauth.SignedGoogleProviderFixture;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Google OAuth is configured for the web client only (empty {@code OAUTH_MOBILE_RETURN_TARGET_URI}): the
 * mobile routes behave like a disabled flow and the web start is unaffected.
 */
@Testcontainers
@Import({TestcontainersConfiguration.class, GoogleOAuthMobileDisabledHttpIntegrationTest.FixtureProviderConfiguration.class})
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class GoogleOAuthMobileDisabledHttpIntegrationTest {

    private static final String ORIGIN = "https://web.test";
    private static final SignedGoogleProviderFixture PROVIDER = SignedGoogleProviderFixture.start();
    private static final String CHALLENGE = OAuthProtocolPolicy.challengeForVerifier(
            "client-verifier-012345678901234567890123456789012");

    @Container
    static final GenericContainer<?> VALKEY = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine")).withExposedPorts(6379);

    @LocalServerPort
    private int port;

    private final ObjectMapper objectMapper = tools.jackson.databind.json.JsonMapper.builder().build();

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    @DynamicPropertySource
    static void dependencies(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.url", () ->
                "redis://" + VALKEY.getHost() + ":" + VALKEY.getMappedPort(6379));
        registry.add("weav.otp.hmac-secret", () -> "identity-http-oauth-hmac-secret-012345678901234567");
        registry.add("weav.oauth.enabled", () -> "true");
        registry.add("weav.oauth.google.client-id", () -> SignedGoogleProviderFixture.CLIENT_ID);
        registry.add("weav.oauth.google.client-secret", () -> "test-provider-secret");
        registry.add("weav.oauth.google.issuer-uri", () -> SignedGoogleProviderFixture.ISSUER);
        registry.add("weav.oauth.google.redirect-uri", () -> "http://127.0.0.1/auth/oauth/google/callback");
        registry.add("weav.oauth.web.return-target-uri", () -> ORIGIN + "/auth/callback");
        registry.add("weav.oauth.web.allowed-origins[0]", () -> ORIGIN);
        registry.add("weav.oauth.mobile.return-target-uri", () -> "");
    }

    @AfterAll
    static void closeProvider() {
        PROVIDER.close();
    }

    @Test
    void mobileRoutesActLikeADisabledFlowWhileTheWebStartStillWorks() throws Exception {
        HttpResponse<String> mobileStart = send("GET",
                "/auth/oauth/google/mobile/start?codeChallenge=" + CHALLENGE + "&codeChallengeMethod=S256", null);
        assertEquals(503, mobileStart.statusCode());
        assertTrue(mobileStart.headers().allValues("Set-Cookie").isEmpty());

        String exchangeBody = objectMapper.writeValueAsString(java.util.Map.of(
                "transactionId", "A".repeat(43),
                "handoffCode", "B".repeat(43),
                "codeVerifier", "C".repeat(43)));
        assertEquals(503, send("POST", "/auth/oauth/mobile/exchange", exchangeBody).statusCode());

        String webStart = objectMapper.writeValueAsString(java.util.Map.of(
                "clientId", "web", "returnTargetId", "web",
                "codeChallenge", CHALLENGE, "codeChallengeMethod", "S256"));
        HttpResponse<String> web = send("POST", "/auth/oauth/google/start", webStart, "Origin", ORIGIN);
        assertEquals(200, web.statusCode());
        JsonNode body = objectMapper.readTree(web.body());
        assertTrue(body.get("authorizationUrl").asText().contains("state="));
    }

    private HttpResponse<String> send(String method, String path, String body, String... headers) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path));
        for (int index = 0; index < headers.length; index += 2) {
            builder.header(headers[index], headers[index + 1]);
        }
        if (body != null) {
            builder.header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(body));
        } else {
            builder.method(method, HttpRequest.BodyPublishers.noBody());
        }
        return httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class FixtureProviderConfiguration {

        @Bean
        @Primary
        OAuthProviderClient signedGoogleProvider(
                OAuthConfiguration configuration,
                KeyedFingerprint fingerprint,
                java.time.Clock clock
        ) {
            return PROVIDER.adapter(configuration, fingerprint, clock);
        }
    }
}
