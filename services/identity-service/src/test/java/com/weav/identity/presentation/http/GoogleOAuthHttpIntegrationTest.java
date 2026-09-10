package com.weav.identity.presentation.http;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.dto.OAuthConfiguration;
import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OAuthProviderClient;
import com.weav.identity.application.validation.OAuthProtocolPolicy;
import com.weav.identity.infrastructure.security.oauth.SignedGoogleProviderFixture;
import com.weav.identity.presentation.http.oauth.OAuthWebProtection;
import com.weav.identity.presentation.http.response.TokenResponse;
import com.weav.identity.presentation.http.response.UserResponse;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Full Spring-security-chain proof for the bounded D2 OAuth HTTP transport. */
@Testcontainers
@Import({TestcontainersConfiguration.class, GoogleOAuthHttpIntegrationTest.FixtureProviderConfiguration.class})
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class GoogleOAuthHttpIntegrationTest {

    private static final String ORIGIN = "https://web.test";
    private static final String RETURN_TARGET = "https://web.test/auth/callback";
    private static final String PASSWORD = "correct-horse-battery-staple";
    private static final String HMAC_SECRET = "identity-http-oauth-hmac-secret-012345678901234567";
    private static final String REFERRER_POLICY_VALUE = "no-referrer";

    private static final SignedGoogleProviderFixture PROVIDER = SignedGoogleProviderFixture.start();

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
    private StringRedisTemplate redis;

    @Autowired
    private ApplicationContext applicationContext;

    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    private RequestMappingHandlerMapping handlerMapping;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    @DynamicPropertySource
    static void dependencies(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.url", () ->
                "redis://" + VALKEY.getHost() + ":" + VALKEY.getMappedPort(6379));
        registry.add("weav.otp.hmac-secret", () -> HMAC_SECRET);
        registry.add("weav.oauth.enabled", () -> "true");
        registry.add("weav.oauth.google.client-id", () -> SignedGoogleProviderFixture.CLIENT_ID);
        registry.add("weav.oauth.google.client-secret", () -> "test-provider-secret");
        registry.add("weav.oauth.google.issuer-uri", () -> SignedGoogleProviderFixture.ISSUER);
        registry.add("weav.oauth.google.redirect-uri", () ->
                "http://127.0.0.1/auth/oauth/google/callback");
        registry.add("weav.oauth.web.return-target-uri", () -> RETURN_TARGET);
        registry.add("weav.oauth.web.allowed-origins[0]", () -> ORIGIN);
    }

    @BeforeEach
    void cleanDatabaseAndValkey() {
        redis.getConnectionFactory().getConnection().serverCommands().flushDb();
        jdbcTemplate.update("delete from identity.oauth_accounts");
        jdbcTemplate.update("delete from identity.user_sessions");
        jdbcTemplate.update("delete from identity.users");
        PROVIDER.resetHits();
    }

    @Test
    void enabledContextRegistersExactlyTheApprovedOAuthHandlerInventory() {
        assertEquals(1, applicationContext.getBeansOfType(OAuthController.class).size());
        assertEquals(1, applicationContext.getBeansOfType(OAuthAccountController.class).size());

        Set<String> oauthRoutes = handlerMapping.getHandlerMethods().keySet().stream()
                .flatMap(mapping -> mapping.getPatternValues().stream())
                .filter(pattern -> pattern.startsWith("/auth/oauth/")
                        || pattern.startsWith("/auth/web/")
                        || pattern.startsWith("/users/me/oauth"))
                .collect(Collectors.toSet());
        assertEquals(Set.of(
                "/auth/oauth/google/start",
                        "/auth/oauth/google/callback",
                        "/auth/oauth/exchange",
                        "/auth/web/csrf",
                        "/auth/web/refresh",
                        "/auth/web/logout",
                        "/users/me/oauth/google/link",
                "/users/me/oauth-accounts",
                "/users/me/oauth-accounts/{accountId}"), oauthRoutes);
    }

    @AfterAll
    static void closeProvider() {
        PROVIDER.close();
    }

    @Test
    void loginFlowUsesSignedProviderAndReturnsAccessOnlyJsonWithRefreshCookie() throws Exception {
        String verifier = verifier("login-flow");
        OAuthFlow flow = startLogin(verifier);
        PROVIDER.setIdentity(flow.nonce(), "http-subject-login", "http-login@gmail.com", true, Instant.now());

        HttpResponse<String> callback = callback(flow, flow.correlationCookie(), "provider-code", null);
        assertEquals(303, callback.statusCode());
        String location = callback.headers().firstValue("Location").orElseThrow();
        assertTrue(location.startsWith(RETURN_TARGET));
        assertFalse(location.contains("provider-code"));
        assertFalse(location.contains("provider-access-token"));
        assertTrue(callback.headers().allValues("Set-Cookie").stream()
                .anyMatch(value -> value.startsWith(OAuthWebProtection.CORRELATION_COOKIE + "=")
                        && value.contains("Max-Age=0")
                        && value.contains("HttpOnly")
                        && value.contains("Secure")
                        && value.contains("SameSite=Lax")));
        assertEquals(0, count("identity.users"));
        assertEquals(0, count("identity.oauth_accounts"));
        assertEquals(0, count("identity.user_sessions"));

        OAuthFlow completed = flow.withHandoff(queryValue(URI.create(location), "handoff_code"));
        HttpResponse<String> exchange = exchange(completed, verifier, null, completed.csrfCookie());
        assertEquals(200, exchange.statusCode());
        JsonNode body = objectMapper.readTree(exchange.body());
        assertEquals("LOGIN", body.get("outcome").asText());
        assertTrue(body.has("accessToken"));
        assertFalse(body.has("refreshToken"));
        assertFalse(body.has("refreshExpiresAt"));
        assertFalse(exchange.body().contains("provider-access-token"));
        assertEquals(1, count("identity.users"));
        assertEquals(1, count("identity.oauth_accounts"));
        assertEquals(1, count("identity.user_sessions"));

        String refreshCookie = cookieValue(exchange, OAuthWebProtection.REFRESH_COOKIE);
        assertNotNull(refreshCookie);
        String refreshHeader = setCookie(exchange, OAuthWebProtection.REFRESH_COOKIE);
        assertTrue(refreshHeader.contains("Path=/auth"));
        assertTrue(refreshHeader.contains("Max-Age=604800"));
        assertTrue(refreshHeader.contains("HttpOnly"));
        assertTrue(refreshHeader.contains("Secure"));
        assertTrue(refreshHeader.contains("SameSite=Lax"));
        assertFalse(refreshCookie.isBlank());
    }

    @Test
    void webRefreshRotatesCookieAndLogoutRevokesSessionWithoutExposingRefreshMaterial() throws Exception {
        String verifier = verifier("web-refresh");
        OAuthFlow flow = startLogin(verifier);
        PROVIDER.setIdentity(flow.nonce(), "http-subject-web-refresh", "web-refresh@gmail.com", true, Instant.now());
        String callbackLocation = callback(flow, flow.correlationCookie(), "web-refresh-code", null)
                .headers().firstValue("Location").orElseThrow();
        OAuthFlow completed = flow.withHandoff(queryValue(URI.create(callbackLocation), "handoff_code"));
        HttpResponse<String> login = exchange(completed, verifier, null, completed.csrfCookie());
        assertEquals(200, login.statusCode());

        String accessToken = objectMapper.readTree(login.body()).get("accessToken").asText();
        String originalRefresh = cookieValue(login, OAuthWebProtection.REFRESH_COOKIE);
        assertNotNull(originalRefresh);
        assertEquals(1, count("identity.user_sessions"));

        HttpResponse<String> refreshed = webRefresh(
                originalRefresh,
                completed.csrfCookie(),
                completed.csrfToken());
        assertEquals(200, refreshed.statusCode());
        assertEquals("no-store", refreshed.headers().firstValue("Cache-Control").orElseThrow());
        JsonNode refreshedBody = objectMapper.readTree(refreshed.body());
        assertEquals("LOGIN", refreshedBody.get("outcome").asText());
        assertTrue(refreshedBody.has("accessToken"));
        assertFalse(refreshedBody.has("refreshToken"));
        assertFalse(refreshedBody.has("refreshExpiresAt"));
        assertFalse(refreshed.body().contains(originalRefresh));
        String replacementRefresh = cookieValue(refreshed, OAuthWebProtection.REFRESH_COOKIE);
        assertNotNull(replacementRefresh);
        assertFalse(originalRefresh.equals(replacementRefresh));
        assertWebRefreshCookie(setCookie(refreshed, OAuthWebProtection.REFRESH_COOKIE), 604800);
        assertEquals(1, count("identity.user_sessions"));
        assertEquals(200, get("/users/me", refreshedBody.get("accessToken").asText(), Map.of()).statusCode());

        HttpResponse<String> replay = webRefresh(
                originalRefresh,
                completed.csrfCookie(),
                completed.csrfToken());
        assertEquals(401, replay.statusCode());
        assertEquals("UNAUTHORIZED", objectMapper.readTree(replay.body()).get("error").get("code").asText());
        assertTrue(replay.headers().allValues("Set-Cookie").isEmpty());
        assertEquals(1, count("identity.user_sessions"));

        jdbcTemplate.update("update identity.user_sessions "
                + "set expires_at = current_timestamp - interval '1 second'");
        HttpResponse<String> expired = webRefresh(
                replacementRefresh,
                completed.csrfCookie(),
                completed.csrfToken());
        assertEquals(401, expired.statusCode());
        assertOAuthErrorHeaders("/auth/web/refresh", expired);
        assertTrue(expired.headers().allValues("Set-Cookie").isEmpty());
        assertEquals(1, count("identity.user_sessions"));
        assertTrue(jdbcTemplate.queryForObject(
                "select revoked_at is null from identity.user_sessions", Boolean.class));

        jdbcTemplate.update("update identity.user_sessions "
                + "set expires_at = current_timestamp + interval '1 hour'");
        jdbcTemplate.update("update identity.users set status = 'DISABLED'");
        HttpResponse<String> disabled = webRefresh(
                replacementRefresh,
                completed.csrfCookie(),
                completed.csrfToken());
        assertEquals(401, disabled.statusCode());
        assertOAuthErrorHeaders("/auth/web/refresh", disabled);
        assertTrue(disabled.headers().allValues("Set-Cookie").isEmpty());
        assertEquals(1, count("identity.user_sessions"));
        jdbcTemplate.update("update identity.users set status = 'ACTIVE'");

        HttpResponse<String> logout = webLogout(
                replacementRefresh,
                completed.csrfCookie(),
                completed.csrfToken());
        assertEquals(204, logout.statusCode());
        assertEquals("no-store", logout.headers().firstValue("Cache-Control").orElseThrow());
        assertEquals("", logout.body());
        String cleared = setCookie(logout, OAuthWebProtection.REFRESH_COOKIE);
        assertWebRefreshCookie(cleared, 0);
        assertTrue(cleared.contains(OAuthWebProtection.REFRESH_COOKIE + "=;"));
        assertEquals(401, get("/users/me", refreshedBody.get("accessToken").asText(), Map.of()).statusCode());

        HttpResponse<String> repeatedLogout = webLogout(
                replacementRefresh,
                completed.csrfCookie(),
                completed.csrfToken());
        assertEquals(204, repeatedLogout.statusCode());
        assertWebRefreshCookie(setCookie(repeatedLogout, OAuthWebProtection.REFRESH_COOKIE), 0);
    }

    @Test
    void webRefreshAndLogoutRejectOriginCsrfAndAmbiguousCookiesBeforeMutation() throws Exception {
        String verifier = verifier("web-admission");
        OAuthFlow flow = startLogin(verifier);
        PROVIDER.setIdentity(flow.nonce(), "http-subject-web-admission", "web-admission@gmail.com", true, Instant.now());
        String callbackLocation = callback(flow, flow.correlationCookie(), "web-admission-code", null)
                .headers().firstValue("Location").orElseThrow();
        OAuthFlow completed = flow.withHandoff(queryValue(URI.create(callbackLocation), "handoff_code"));
        HttpResponse<String> login = exchange(completed, verifier, null, completed.csrfCookie());
        String refresh = cookieValue(login, OAuthWebProtection.REFRESH_COOKIE);
        assertNotNull(refresh);

        Map<String, String> valid = Map.of(
                "Origin", ORIGIN,
                "Cookie", cookieHeader(completed.csrfCookie(), refresh),
                OAuthWebProtection.CSRF_HEADER, completed.csrfToken());
        Map<String, String> invalidOrigin = new HashMap<>(valid);
        invalidOrigin.put("Origin", "https://evil.test");
        HttpResponse<String> originRejected = send("POST", "/auth/web/refresh", null, invalidOrigin);
        assertEquals(403, originRejected.statusCode());
        assertOAuthErrorHeaders("/auth/web/refresh", originRejected);
        assertTrue(originRejected.headers().allValues("Set-Cookie").isEmpty());

        Map<String, String> invalidCsrf = new HashMap<>(valid);
        invalidCsrf.put(OAuthWebProtection.CSRF_HEADER, verifier("wrong-web-csrf"));
        HttpResponse<String> csrfRejected = send("POST", "/auth/web/refresh", null, invalidCsrf);
        assertEquals(403, csrfRejected.statusCode());
        assertOAuthErrorHeaders("/auth/web/refresh", csrfRejected);
        assertTrue(csrfRejected.headers().allValues("Set-Cookie").isEmpty());

        Map<String, String> duplicateRefresh = new HashMap<>(valid);
        duplicateRefresh.put("Cookie", cookieHeader(
                completed.csrfCookie(),
                refresh,
                refresh));
        HttpResponse<String> duplicateRejected = send("POST", "/auth/web/refresh", null, duplicateRefresh);
        assertEquals(401, duplicateRejected.statusCode());
        assertOAuthErrorHeaders("/auth/web/refresh", duplicateRejected);
        assertTrue(duplicateRejected.headers().allValues("Set-Cookie").isEmpty());

        Map<String, String> malformedRefresh = new HashMap<>(valid);
        malformedRefresh.put("Cookie", cookieHeader(completed.csrfCookie(), "__Secure-weav_refresh=not-a-refresh-token"));
        HttpResponse<String> malformedRejected = send("POST", "/auth/web/refresh", null, malformedRefresh);
        assertEquals(401, malformedRejected.statusCode());
        assertOAuthErrorHeaders("/auth/web/refresh", malformedRejected);
        assertTrue(malformedRejected.headers().allValues("Set-Cookie").isEmpty());

        Map<String, String> oversizedRefresh = new HashMap<>(valid);
        oversizedRefresh.put("Cookie", cookieHeader(
                completed.csrfCookie(),
                OAuthWebProtection.REFRESH_COOKIE + "=" + "A".repeat(2049)));
        HttpResponse<String> oversizedRejected = send("POST", "/auth/web/refresh", null, oversizedRefresh);
        assertEquals(401, oversizedRejected.statusCode());
        assertOAuthErrorHeaders("/auth/web/refresh", oversizedRejected);
        assertTrue(oversizedRejected.headers().allValues("Set-Cookie").isEmpty());

        HttpResponse<String> bodyOnly = post(
                "/auth/web/refresh",
                Map.of("refreshToken", refresh),
                Map.of(
                        "Origin", ORIGIN,
                        "Cookie", completed.csrfCookie(),
                        OAuthWebProtection.CSRF_HEADER, completed.csrfToken()));
        assertEquals(401, bodyOnly.statusCode());
        assertOAuthErrorHeaders("/auth/web/refresh", bodyOnly);
        assertTrue(bodyOnly.headers().allValues("Set-Cookie").isEmpty());
        assertEquals(1, count("identity.user_sessions"));

        Map<String, String> malformedBearer = new HashMap<>(valid);
        malformedBearer.put("Authorization", "Bearer malformed");
        HttpResponse<String> malformedBearerRejected = send(
                "POST", "/auth/web/refresh", null, malformedBearer);
        assertEquals(401, malformedBearerRejected.statusCode());
        assertOAuthErrorHeaders("/auth/web/refresh", malformedBearerRejected);
        assertTrue(malformedBearerRejected.headers().allValues("Set-Cookie").isEmpty());
        assertEquals(1, count("identity.user_sessions"));

        HttpResponse<String> logoutOriginRejected = send("POST", "/auth/web/logout", null, invalidOrigin);
        assertEquals(403, logoutOriginRejected.statusCode());
        assertOAuthErrorHeaders("/auth/web/logout", logoutOriginRejected);
        assertTrue(logoutOriginRejected.headers().allValues("Set-Cookie").isEmpty());
        assertEquals(1, count("identity.user_sessions"));

        HttpResponse<String> logout = webLogout(refresh, completed.csrfCookie(), completed.csrfToken());
        assertEquals(204, logout.statusCode());
        assertWebRefreshCookie(setCookie(logout, OAuthWebProtection.REFRESH_COOKIE), 0);
    }

    @Test
    void concurrentWebRefreshHasExactlyOneRotationWinner() throws Exception {
        String verifier = verifier("web-concurrent");
        OAuthFlow flow = startLogin(verifier);
        PROVIDER.setIdentity(flow.nonce(), "http-subject-web-concurrent", "web-concurrent@gmail.com", true, Instant.now());
        String callbackLocation = callback(flow, flow.correlationCookie(), "web-concurrent-code", null)
                .headers().firstValue("Location").orElseThrow();
        OAuthFlow completed = flow.withHandoff(queryValue(URI.create(callbackLocation), "handoff_code"));
        HttpResponse<String> login = exchange(completed, verifier, null, completed.csrfCookie());
        String refresh = cookieValue(login, OAuthWebProtection.REFRESH_COOKIE);
        assertNotNull(refresh);

        CompletableFuture<HttpResponse<String>> first = CompletableFuture.supplyAsync(() -> {
            try {
                return webRefresh(refresh, completed.csrfCookie(), completed.csrfToken());
            } catch (Exception exception) {
                throw new RuntimeException(exception);
            }
        });
        CompletableFuture<HttpResponse<String>> second = CompletableFuture.supplyAsync(() -> {
            try {
                return webRefresh(refresh, completed.csrfCookie(), completed.csrfToken());
            } catch (Exception exception) {
                throw new RuntimeException(exception);
            }
        });

        List<Integer> statuses = List.of(first.join().statusCode(), second.join().statusCode()).stream()
                .sorted()
                .toList();
        assertEquals(List.of(200, 401), statuses);
        assertEquals(1, count("identity.user_sessions"));
    }

    @Test
    void callbackRejectsWrongCookieAndCancellationIsOneUse() throws Exception {
        OAuthFlow flow = startLogin(verifier("wrong-cookie"));
        PROVIDER.setIdentity(flow.nonce(), "http-subject-cookie", "cookie@gmail.com", true, Instant.now());
        int tokenHitsBefore = PROVIDER.tokenHits();

        HttpResponse<String> wrongCookie = callback(flow, OAuthWebProtection.CORRELATION_COOKIE + "=" + "A".repeat(43),
                "provider-code", null);
        assertEquals(400, wrongCookie.statusCode());
        assertNull(wrongCookie.headers().firstValue("Location").orElse(null));
        assertEquals(tokenHitsBefore, PROVIDER.tokenHits());
        assertEquals(0, count("identity.users"));

        HttpResponse<String> valid = callback(flow, flow.correlationCookie(), "provider-code", null);
        assertEquals(303, valid.statusCode());
        assertEquals(1, PROVIDER.tokenHits());

        OAuthFlow cancelled = startLogin(verifier("cancel-flow"));
        HttpResponse<String> cancellation = callback(cancelled, cancelled.correlationCookie(), null, "access_denied");
        assertEquals(303, cancellation.statusCode());
        assertTrue(cancellation.headers().firstValue("Location").orElseThrow().contains("oauth_error=cancelled"));
        HttpResponse<String> replay = callback(cancelled, cancelled.correlationCookie(), null, "access_denied");
        assertEquals(400, replay.statusCode());
        assertNull(replay.headers().firstValue("Location").orElse(null));
        assertEquals(1, PROVIDER.tokenHits());
    }

    @Test
    void wrongVerifierAndMalformedBearerDoNotBurnOrDowngradeTheHandoff() throws Exception {
        String verifier = verifier("retry-flow");
        OAuthFlow flow = startLogin(verifier);
        PROVIDER.setIdentity(flow.nonce(), "http-subject-retry", "retry@gmail.com", true, Instant.now());
        String location = callback(flow, flow.correlationCookie(), "provider-code", null)
                .headers().firstValue("Location").orElseThrow();
        OAuthFlow completed = flow.withHandoff(queryValue(URI.create(location), "handoff_code"));

        HttpResponse<String> malformedBearer = exchange(
                completed,
                verifier,
                "malformed-authorization",
                completed.csrfCookie());
        assertEquals(401, malformedBearer.statusCode());
        assertEquals(0, count("identity.users"));

        HttpResponse<String> emptyBearer = exchange(
                completed,
                verifier,
                "",
                completed.csrfCookie());
        assertEquals(401, emptyBearer.statusCode());
        assertEquals(0, count("identity.users"));

        HttpResponse<String> wrongVerifier = exchange(
                completed,
                verifier("wrong-proof"),
                null,
                completed.csrfCookie());
        assertEquals(401, wrongVerifier.statusCode());
        assertEquals("OAUTH_HANDOFF_INVALID", objectMapper.readTree(wrongVerifier.body())
                .get("error").get("code").asText());
        assertEquals(0, count("identity.users"));

        HttpResponse<String> valid = exchange(completed, verifier, null, completed.csrfCookie());
        assertEquals(200, valid.statusCode());
        assertEquals(1, count("identity.user_sessions"));
    }

    @Test
    void unsafeRoutesRejectMissingOrMismatchedOriginAndCsrfBeforeMutation() throws Exception {
        Map<String, Object> startBody = Map.of(
                "clientId", "web",
                "returnTargetId", "web",
                "codeChallenge", OAuthProtocolPolicy.challengeForVerifier(verifier("origin")),
                "codeChallengeMethod", "S256");

        assertEquals(403, post("/auth/oauth/google/start", startBody, Map.of()).statusCode());
        assertEquals(403, post(
                "/auth/oauth/google/start",
                startBody,
                Map.of("Origin", "https://evil.test")).statusCode());
        assertEquals(0, count("identity.users"));

        String codeVerifier = verifier("csrf");
        OAuthFlow flow = startLogin(codeVerifier);
        PROVIDER.setIdentity(flow.nonce(), "http-subject-csrf", "csrf@gmail.com", true, Instant.now());
        HttpResponse<String> callback = callback(flow, flow.correlationCookie(), "csrf-code", null);
        OAuthFlow completed = flow.withHandoff(queryValue(
                URI.create(callback.headers().firstValue("Location").orElseThrow()), "handoff_code"));

        Map<String, String> missingCsrf = Map.of(
                "Origin", ORIGIN,
                "Cookie", completed.csrfCookie());
        assertEquals(403, post("/auth/oauth/exchange", exchangeBody(completed, codeVerifier), missingCsrf).statusCode());

        Map<String, String> mismatchedCsrf = Map.of(
                "Origin", ORIGIN,
                "Cookie", completed.csrfCookie(),
                OAuthWebProtection.CSRF_HEADER, verifier("wrong-csrf"));
        assertEquals(403, post(
                "/auth/oauth/exchange",
                exchangeBody(completed, codeVerifier),
                mismatchedCsrf).statusCode());
        assertEquals(0, count("identity.users"));

        Map<String, String> duplicateCsrf = Map.of(
                "Origin", ORIGIN,
                "Cookie", completed.csrfCookie() + "; " + completed.csrfCookie(),
                OAuthWebProtection.CSRF_HEADER, completed.csrfToken());
        assertEquals(403, post(
                "/auth/oauth/exchange",
                exchangeBody(completed, codeVerifier),
                duplicateCsrf).statusCode());
        assertEquals(0, count("identity.users"));

        assertEquals(200, exchange(completed, codeVerifier, null, completed.csrfCookie()).statusCode());
    }

    @Test
    void linkListAndUnlinkUseBearerIdentityWithoutMintingOrOverwritingCookies() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String email = "http-link-" + suffix + "@example.com";
        UserResponse user = register(email);
        TokenResponse session = login(email);

        OAuthFlow csrf = bootstrapCsrf();
        String verifier = verifier("link-flow");
        HttpResponse<String> start = post(
                "/users/me/oauth/google/link",
                Map.of(
                        "currentPassword", PASSWORD,
                        "clientId", "web",
                        "returnTargetId", "web",
                        "codeChallenge", OAuthProtocolPolicy.challengeForVerifier(verifier),
                        "codeChallengeMethod", "S256"),
                Map.of(
                        "Origin", ORIGIN,
                        "Authorization", "Bearer " + session.accessToken(),
                        "Cookie", csrf.csrfCookie(),
                        OAuthWebProtection.CSRF_HEADER, csrf.csrfToken()));
        assertEquals(200, start.statusCode());
        OAuthFlow link = flowFromStart(start, verifier);
        PROVIDER.setIdentity(link.nonce(), "http-subject-link", "third-party@example.net", true, Instant.now());
        String callbackLocation = callback(link, link.correlationCookie(), "provider-link-code", null)
                .headers().firstValue("Location").orElseThrow();
        OAuthFlow linkCompleted = link.withHandoff(queryValue(URI.create(callbackLocation), "handoff_code"));

        int sessionsBefore = count("identity.user_sessions");
        HttpResponse<String> linked = exchange(
                linkCompleted,
                verifier,
                session.accessToken(),
                linkCompleted.csrfCookie());
        assertEquals(200, linked.statusCode());
        JsonNode linkedBody = objectMapper.readTree(linked.body());
        assertEquals("LINKED", linkedBody.get("outcome").asText());
        assertFalse(linkedBody.has("accessToken"));
        assertFalse(linkedBody.has("refreshToken"));
        assertTrue(linked.headers().allValues("Set-Cookie").isEmpty());
        assertEquals(sessionsBefore, count("identity.user_sessions"));
        assertEquals(1, count("identity.oauth_accounts"));

        JsonNode accounts = objectMapper.readTree(get(
                "/users/me/oauth-accounts",
                session.accessToken(),
                Map.of()).body());
        assertEquals(1, accounts.size());
        String accountId = accounts.get(0).get("id").asText();
        assertTrue(accounts.get(0).has("provider"));
        assertTrue(accounts.get(0).has("providerEmail"));
        assertFalse(accounts.get(0).has("providerUserId"));
        assertFalse(accounts.get(0).has("sub"));
        assertFalse(accounts.toString().contains("http-subject-link"));

        UserResponse other = register("http-other-" + suffix + "@example.com");
        TokenResponse otherSession = login(other.email());
        HttpResponse<String> wrongOwner = delete(
                "/users/me/oauth-accounts/" + accountId,
                Map.of(
                        "Origin", ORIGIN,
                        "Authorization", "Bearer " + otherSession.accessToken(),
                        "Cookie", linkCompleted.csrfCookie(),
                        OAuthWebProtection.CSRF_HEADER, linkCompleted.csrfToken()),
                Map.of("currentPassword", PASSWORD));
        assertEquals(404, wrongOwner.statusCode());

        for (int attempt = 0; attempt < 5; attempt++) {
            HttpResponse<String> wrongPassword = delete(
                    "/users/me/oauth-accounts/" + accountId,
                    Map.of(
                            "Origin", ORIGIN,
                            "Authorization", "Bearer " + session.accessToken(),
                            "Cookie", linkCompleted.csrfCookie(),
                            OAuthWebProtection.CSRF_HEADER, linkCompleted.csrfToken()),
                    Map.of("currentPassword", "wrong-password"));
            assertEquals(401, wrongPassword.statusCode());
        }
        HttpResponse<String> rateLimited = delete(
                "/users/me/oauth-accounts/" + accountId,
                Map.of(
                        "Origin", ORIGIN,
                        "Authorization", "Bearer " + session.accessToken(),
                        "Cookie", linkCompleted.csrfCookie(),
                        OAuthWebProtection.CSRF_HEADER, linkCompleted.csrfToken()),
                Map.of("currentPassword", "wrong-password"));
        assertEquals(429, rateLimited.statusCode());
        assertNotNull(rateLimited.headers().firstValue("Retry-After").orElse(null));
        assertEquals("no-store", rateLimited.headers().firstValue("Cache-Control").orElseThrow());
        assertEquals(1, count("identity.oauth_accounts"));

        TokenResponse unlinkedSession = login(email);
        HttpResponse<String> unlinked = delete(
                "/users/me/oauth-accounts/" + accountId,
                Map.of(
                        "Origin", ORIGIN,
                        "Authorization", "Bearer " + unlinkedSession.accessToken(),
                        "Cookie", linkCompleted.csrfCookie(),
                        OAuthWebProtection.CSRF_HEADER, linkCompleted.csrfToken()),
                Map.of("currentPassword", PASSWORD));
        assertEquals(204, unlinked.statusCode());
        assertEquals(0, objectMapper.readTree(get(
                "/users/me/oauth-accounts",
                session.accessToken(),
                Map.of()).body()).size());
        assertEquals(200, get("/users/me", session.accessToken(), Map.of()).statusCode());
        assertEquals(user.id().toString(), session.user().id().toString());
    }

    @Test
    void oauthOnlyUnlinkChecksLastMethodBeforePasswordValidationAndCorsIsExact() throws Exception {
        HttpResponse<String> preflight = options(
                "/auth/oauth/google/start",
                Map.of(
                        "Origin", ORIGIN,
                        "Access-Control-Request-Method", "POST",
                        "Access-Control-Request-Headers", "content-type,x-xsrf-token"));
        assertTrue(preflight.statusCode() == 200 || preflight.statusCode() == 204);
        assertEquals(ORIGIN, preflight.headers().firstValue("Access-Control-Allow-Origin").orElseThrow());
        assertEquals("true", preflight.headers().firstValue("Access-Control-Allow-Credentials").orElseThrow());
        assertFalse("*".equals(preflight.headers().firstValue("Access-Control-Allow-Origin").orElse(null)));

        HttpResponse<String> wrongOrigin = options(
                "/auth/oauth/google/start",
                Map.of(
                        "Origin", "http://evil.test",
                        "Access-Control-Request-Method", "POST"));
        assertEquals(403, wrongOrigin.statusCode());
        assertEquals(0, count("identity.users"));

        UserResponse corsUser = register("http-cors-current-user@example.com");
        TokenResponse corsSession = login(corsUser.email());
        HttpResponse<String> allowedCurrentUser = get(
                "/users/me",
                corsSession.accessToken(),
                Map.of("Origin", ORIGIN));
        assertEquals(200, allowedCurrentUser.statusCode());
        assertEquals(ORIGIN, allowedCurrentUser.headers()
                .firstValue("Access-Control-Allow-Origin").orElseThrow());
        assertEquals("true", allowedCurrentUser.headers()
                .firstValue("Access-Control-Allow-Credentials").orElseThrow());

        HttpResponse<String> currentUserPreflight = options(
                "/users/me",
                Map.of(
                        "Origin", ORIGIN,
                        "Access-Control-Request-Method", "GET",
                        "Access-Control-Request-Headers", "authorization"));
        assertTrue(currentUserPreflight.statusCode() == 200 || currentUserPreflight.statusCode() == 204);
        assertEquals(ORIGIN, currentUserPreflight.headers()
                .firstValue("Access-Control-Allow-Origin").orElseThrow());
        assertEquals("true", currentUserPreflight.headers()
                .firstValue("Access-Control-Allow-Credentials").orElseThrow());
        assertTrue(currentUserPreflight.headers()
                .firstValue("Access-Control-Allow-Methods").orElseThrow().contains("GET"));
        assertFalse(currentUserPreflight.headers()
                .firstValue("Access-Control-Allow-Methods").orElseThrow().contains("POST"));
        assertTrue(currentUserPreflight.headers()
                .firstValue("Access-Control-Allow-Headers").orElseThrow().toLowerCase().contains("authorization"));

        HttpResponse<String> currentUserPostPreflight = options(
                "/users/me",
                Map.of(
                        "Origin", ORIGIN,
                        "Access-Control-Request-Method", "POST",
                        "Access-Control-Request-Headers", "content-type"));
        assertEquals(403, currentUserPostPreflight.statusCode());

        HttpResponse<String> currentUserWrongOrigin = options(
                "/users/me",
                Map.of(
                        "Origin", "http://evil.test",
                        "Access-Control-Request-Method", "GET",
                        "Access-Control-Request-Headers", "authorization"));
        assertEquals(403, currentUserWrongOrigin.statusCode());

        HttpResponse<String> unrelatedUserPreflight = options(
                "/users/me/sessions",
                Map.of(
                        "Origin", ORIGIN,
                        "Access-Control-Request-Method", "GET",
                        "Access-Control-Request-Headers", "authorization"));
        assertFalse(unrelatedUserPreflight.headers().firstValue("Access-Control-Allow-Origin").isPresent());

        String verifier = verifier("oauth-only");
        OAuthFlow flow = startLogin(verifier);
        PROVIDER.setIdentity(flow.nonce(), "http-subject-only", "oauth-only@gmail.com", true, Instant.now());
        String callbackLocation = callback(flow, flow.correlationCookie(), "oauth-only-code", null)
                .headers().firstValue("Location").orElseThrow();
        OAuthFlow completed = flow.withHandoff(queryValue(URI.create(callbackLocation), "handoff_code"));
        HttpResponse<String> login = exchange(completed, verifier, null, completed.csrfCookie());
        assertEquals(200, login.statusCode());
        String accessToken = objectMapper.readTree(login.body()).get("accessToken").asText();
        String accountId = objectMapper.readTree(get(
                "/users/me/oauth-accounts", accessToken, Map.of()).body()).get(0).get("id").asText();
        OAuthFlow csrf = completed;

        jdbcTemplate.update("update identity.users set password_hash = null where id = ?",
                UUID.fromString(objectMapper.readTree(login.body()).get("user").get("id").asText()));
        HttpResponse<String> lastMethod = delete(
                "/users/me/oauth-accounts/" + accountId,
                Map.of(
                        "Origin", ORIGIN,
                        "Authorization", "Bearer " + accessToken,
                        "Cookie", csrf.csrfCookie(),
                        OAuthWebProtection.CSRF_HEADER, csrf.csrfToken()),
                Map.of());
        assertEquals(409, lastMethod.statusCode());
        assertEquals("OAUTH_LAST_LOGIN_METHOD", objectMapper.readTree(lastMethod.body())
                .get("error").get("code").asText());
        assertEquals(1, count("identity.oauth_accounts"));
    }

    private OAuthFlow startLogin(String verifier) throws Exception {
        HttpResponse<String> response = post(
                "/auth/oauth/google/start",
                Map.of(
                        "clientId", "web",
                        "returnTargetId", "web",
                        "codeChallenge", OAuthProtocolPolicy.challengeForVerifier(verifier),
                        "codeChallengeMethod", "S256"),
                Map.of("Origin", ORIGIN));
        assertEquals(200, response.statusCode());
        return flowFromStart(response, verifier);
    }

    private OAuthFlow flowFromStart(HttpResponse<String> response, String verifier) throws Exception {
        JsonNode body = objectMapper.readTree(response.body());
        URI authorizationUrl = URI.create(body.get("authorizationUrl").asText());
        Map<String, String> query = query(authorizationUrl);
        return new OAuthFlow(
                verifier,
                body.get("transactionId").asText(),
                query.get("state"),
                query.get("nonce"),
                body.get("csrfToken").asText(),
                cookie(response, OAuthWebProtection.CSRF_COOKIE),
                cookie(response, OAuthWebProtection.CORRELATION_COOKIE),
                null);
    }

    private OAuthFlow bootstrapCsrf() throws Exception {
        HttpResponse<String> response = get("/auth/web/csrf", null, Map.of("Origin", ORIGIN));
        assertEquals(200, response.statusCode());
        return new OAuthFlow(
                null,
                null,
                null,
                null,
                objectMapper.readTree(response.body()).get("csrfToken").asText(),
                cookie(response, OAuthWebProtection.CSRF_COOKIE),
                null,
                null);
    }

    private HttpResponse<String> callback(
            OAuthFlow flow,
            String cookie,
            String code,
            String error
    ) throws Exception {
        StringBuilder path = new StringBuilder("/auth/oauth/google/callback?code=")
                .append(code == null ? "" : URLEncoder.encode(code, StandardCharsets.UTF_8))
                .append("&state=")
                .append(URLEncoder.encode(flow.state(), StandardCharsets.UTF_8));
        if (error != null) {
            path.append("&error=").append(URLEncoder.encode(error, StandardCharsets.UTF_8));
        }
        HttpResponse<String> response = send("GET", path.toString(), null, Map.of("Cookie", cookie));
        assertOAuthReferrerPolicy(path.toString(), response);
        return response;
    }

    private HttpResponse<String> exchange(
            OAuthFlow flow,
            String verifier,
            String accessToken,
            String csrfCookie
    ) throws Exception {
        Map<String, String> headers = new HashMap<>();
        headers.put("Origin", ORIGIN);
        headers.put("Cookie", csrfCookie);
        headers.put(OAuthWebProtection.CSRF_HEADER, flow.csrfToken());
        if (accessToken != null) {
            headers.put("Authorization", "Bearer " + accessToken);
        }
        return post(
                "/auth/oauth/exchange",
                exchangeBody(flow, verifier),
                headers);
    }

    private HttpResponse<String> webRefresh(
            String refreshToken,
            String csrfCookie,
            String csrfToken
    ) throws Exception {
        HttpResponse<String> response = send(
                "POST",
                "/auth/web/refresh",
                null,
                Map.of(
                        "Origin", ORIGIN,
                        "Cookie", cookieHeader(csrfCookie, OAuthWebProtection.REFRESH_COOKIE + "=" + refreshToken),
                        OAuthWebProtection.CSRF_HEADER, csrfToken));
        assertOAuthReferrerPolicy("/auth/web/refresh", response);
        return response;
    }

    private HttpResponse<String> webLogout(
            String refreshToken,
            String csrfCookie,
            String csrfToken
    ) throws Exception {
        HttpResponse<String> response = send(
                "POST",
                "/auth/web/logout",
                null,
                Map.of(
                        "Origin", ORIGIN,
                        "Cookie", cookieHeader(csrfCookie, OAuthWebProtection.REFRESH_COOKIE + "=" + refreshToken),
                        OAuthWebProtection.CSRF_HEADER, csrfToken));
        assertOAuthReferrerPolicy("/auth/web/logout", response);
        return response;
    }

    private Map<String, String> exchangeBody(OAuthFlow flow, String verifier) {
        return Map.of(
                "clientId", "web",
                "returnTargetId", "web",
                "transactionId", flow.transactionId(),
                "handoffCode", flow.handoffCode(),
                "codeVerifier", verifier);
    }

    private UserResponse register(String email) throws Exception {
        HttpResponse<String> response = post(
                "/auth/register",
                Map.of("email", email, "password", PASSWORD, "displayName", "HTTP OAuth"),
                Map.of());
        assertEquals(201, response.statusCode());
        return objectMapper.readValue(response.body(), UserResponse.class);
    }

    private TokenResponse login(String email) throws Exception {
        HttpResponse<String> response = post(
                "/auth/login",
                Map.of("email", email, "password", PASSWORD),
                Map.of());
        assertEquals(200, response.statusCode());
        return objectMapper.readValue(response.body(), TokenResponse.class);
    }

    private HttpResponse<String> post(String path, Object body, Map<String, String> headers) throws Exception {
        HttpResponse<String> response = send("POST", path, objectMapper.writeValueAsString(body), headers);
        assertOAuthReferrerPolicy(path, response);
        return response;
    }

    private HttpResponse<String> get(String path, String accessToken, Map<String, String> headers) throws Exception {
        Map<String, String> merged = new HashMap<>(headers);
        if (accessToken != null) {
            merged.put("Authorization", "Bearer " + accessToken);
        }
        HttpResponse<String> response = send("GET", path, null, merged);
        assertOAuthReferrerPolicy(path, response);
        return response;
    }

    private HttpResponse<String> delete(String path, Map<String, String> headers, Object body) throws Exception {
        HttpResponse<String> response = send("DELETE", path, objectMapper.writeValueAsString(body), headers);
        assertOAuthReferrerPolicy(path, response);
        return response;
    }

    private HttpResponse<String> options(String path, Map<String, String> headers) throws Exception {
        return send("OPTIONS", path, null, headers);
    }

    private HttpResponse<String> send(
            String method,
            String path,
            String body,
            Map<String, String> headers
    ) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path));
        headers.forEach(builder::header);
        if (body != null) {
            builder.header("Content-Type", "application/json");
        }
        switch (method) {
            case "GET" -> builder.GET();
            case "POST" -> builder.POST(body == null
                    ? HttpRequest.BodyPublishers.noBody()
                    : HttpRequest.BodyPublishers.ofString(body));
            case "DELETE" -> builder.method("DELETE", body == null
                    ? HttpRequest.BodyPublishers.noBody()
                    : HttpRequest.BodyPublishers.ofString(body));
            case "OPTIONS" -> builder.method("OPTIONS", HttpRequest.BodyPublishers.noBody());
            default -> throw new IllegalArgumentException("Unsupported method");
        }
        return httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    private static void assertOAuthReferrerPolicy(String path, HttpResponse<String> response) {
        if (path.startsWith("/auth/oauth/")
                || path.startsWith("/auth/web/")
                || path.startsWith("/users/me/oauth")) {
            assertEquals(REFERRER_POLICY_VALUE,
                    response.headers().firstValue("Referrer-Policy").orElseThrow());
        }
    }

    private static void assertOAuthErrorHeaders(String path, HttpResponse<String> response) {
        assertOAuthReferrerPolicy(path, response);
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
    }

    private int count(String table) {
        return jdbcTemplate.queryForObject("select count(*) from " + table, Integer.class);
    }

    private static String verifier(String seed) {
        String base = "client-verifier-012345678901234567890123456789012-" + seed;
        return base.substring(0, 52);
    }

    private static String cookie(HttpResponse<String> response, String name) {
        return response.headers().allValues("Set-Cookie").stream()
                .filter(value -> value.startsWith(name + "="))
                .map(value -> value.substring(0, value.indexOf(';')))
                .findFirst()
                .orElseThrow(() -> new AssertionError("Missing cookie " + name));
    }

    private static String cookieValue(HttpResponse<String> response, String name) {
        return response.headers().allValues("Set-Cookie").stream()
                .filter(value -> value.startsWith(name + "="))
                .map(value -> value.substring(name.length() + 1, value.indexOf(';')))
                .findFirst()
                .orElse(null);
    }

    private static String setCookie(HttpResponse<String> response, String name) {
        return response.headers().allValues("Set-Cookie").stream()
                .filter(value -> value.startsWith(name + "="))
                .findFirst()
                .orElseThrow(() -> new AssertionError("Missing Set-Cookie " + name));
    }

    private static String cookieHeader(String... cookies) {
        return String.join("; ", cookies);
    }

    private static void assertWebRefreshCookie(String value, long maxAge) {
        assertTrue(value.contains("Path=/auth"));
        assertTrue(value.contains("Max-Age=" + maxAge));
        assertTrue(value.contains("HttpOnly"));
        assertTrue(value.contains("Secure"));
        assertTrue(value.contains("SameSite=Lax"));
    }

    private static Map<String, String> query(URI uri) {
        Map<String, String> values = new HashMap<>();
        for (String part : uri.getRawQuery().split("&")) {
            String[] keyValue = part.split("=", 2);
            values.put(
                    URLDecoder.decode(keyValue[0], StandardCharsets.UTF_8),
                    URLDecoder.decode(keyValue.length == 1 ? "" : keyValue[1], StandardCharsets.UTF_8));
        }
        return values;
    }

    private static String queryValue(URI uri, String key) {
        return query(uri).get(key);
    }

    private record OAuthFlow(
            String verifier,
            String transactionId,
            String state,
            String nonce,
            String csrfToken,
            String csrfCookie,
            String correlationCookie,
            String handoffCode
    ) {
        private OAuthFlow withHandoff(String value) {
            return new OAuthFlow(
                    verifier,
                    transactionId,
                    state,
                    nonce,
                    csrfToken,
                    csrfCookie,
                    correlationCookie,
                    value);
        }
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
