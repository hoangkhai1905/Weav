package com.weav.identity.presentation.http;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.dto.OAuthConfiguration;
import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OAuthProviderClient;
import com.weav.identity.infrastructure.security.oauth.SignedGoogleProviderFixture;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.core.annotation.Order;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Opt-in real-browser proof for the local signed-provider M3 web flow.
 *
 * <p>Run explicitly with {@code -Dm3.browser.enabled=true}. The normal Maven
 * suite skips this class because it waits for a human-controlled browser.</p>
 */
@EnabledIfSystemProperty(named = "m3.browser.enabled", matches = "true")
@Testcontainers
@Import({
        TestcontainersConfiguration.class,
        M3BrowserAcceptanceFixtureTest.FixtureProviderConfiguration.class,
        M3BrowserAcceptanceFixtureTest.CookieProbeConfiguration.class
})
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT,
        properties = "server.port=8081"
)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class M3BrowserAcceptanceFixtureTest {

    private static final String IDENTITY_ORIGIN = "http://localhost:8081";
    private static final String HARNESS_ORIGIN = "http://localhost:5173";
    private static final String HMAC_SECRET = "m3-browser-fixture-hmac-secret-012345678901234567";
    private static final SignedGoogleProviderFixture PROVIDER = SignedGoogleProviderFixture.start();
    private static final AtomicBoolean CALLBACK_REACHED = new AtomicBoolean();
    private static final AtomicReference<String> BROWSER_RESULT = new AtomicReference<>();
    private static final AtomicReference<JdbcTemplate> DATABASE = new AtomicReference<>();
    private static HttpServer harness;

    @Container
    static final GenericContainer<?> VALKEY = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine")).withExposedPorts(6379);

    @org.springframework.beans.factory.annotation.Autowired
    private JdbcTemplate jdbcTemplate;

    @org.springframework.beans.factory.annotation.Autowired
    private StringRedisTemplate redis;

    @DynamicPropertySource
    static void dependencies(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.url", () ->
                "redis://" + VALKEY.getHost() + ":" + VALKEY.getMappedPort(6379));
        registry.add("weav.otp.hmac-secret", () -> HMAC_SECRET);
        registry.add("weav.oauth.enabled", () -> "true");
        registry.add("weav.oauth.google.client-id", () -> SignedGoogleProviderFixture.CLIENT_ID);
        registry.add("weav.oauth.google.client-secret", () -> "m3-browser-fixture-secret");
        registry.add("weav.oauth.google.issuer-uri", () -> SignedGoogleProviderFixture.ISSUER);
        registry.add("weav.oauth.google.redirect-uri", () ->
                IDENTITY_ORIGIN + "/auth/oauth/google/callback");
        registry.add("weav.oauth.web.return-target-uri", () -> HARNESS_ORIGIN + "/auth/callback");
        registry.add("weav.oauth.web.allowed-origins[0]", () -> HARNESS_ORIGIN);
    }

    @BeforeAll
    static void startHarness() throws IOException {
        harness = HttpServer.create(new InetSocketAddress("localhost", 5173), 0);
        harness.createContext("/", M3BrowserAcceptanceFixtureTest::serveHarnessPage);
        harness.createContext("/__m3/state", M3BrowserAcceptanceFixtureTest::receiveBrowserState);
        harness.createContext("/__m3/complete", M3BrowserAcceptanceFixtureTest::receiveBrowserResult);
        harness.start();
        Path ready = Path.of("target", "m3-browser-harness", "READY");
        Files.createDirectories(ready.getParent());
        Files.writeString(ready, HARNESS_ORIGIN + "\n" + IDENTITY_ORIGIN + "\n", StandardCharsets.UTF_8);
    }

    @AfterAll
    static void stopHarness() throws IOException {
        if (harness != null) {
            harness.stop(0);
        }
        DATABASE.set(null);
        PROVIDER.close();
    }

    @BeforeEach
    void cleanState() {
        BROWSER_RESULT.set(null);
        CALLBACK_REACHED.set(false);
        DATABASE.set(jdbcTemplate);
        redis.getConnectionFactory().getConnection().serverCommands().flushDb();
        jdbcTemplate.update("delete from identity.oauth_accounts");
        jdbcTemplate.update("delete from identity.user_sessions");
        jdbcTemplate.update("delete from identity.users");
        PROVIDER.resetHits();
    }

    @Test
    void browserFixtureCompletesLoginRefreshAndLogout() throws Exception {
        Path resultPath = Path.of("target", "m3-browser-harness", "result.txt");
        Files.deleteIfExists(resultPath);
        long deadline = System.nanoTime() + Duration.ofMinutes(5).toNanos();
        while (BROWSER_RESULT.get() == null && System.nanoTime() < deadline) {
            Thread.sleep(250);
        }

        String resultBody = BROWSER_RESULT.get();
        assertNotNull(resultBody, "Open http://localhost:5173 and run the browser fixture");
        Map<String, String> result = parseResult(resultBody);
        Files.writeString(resultPath, resultBody + "\n", StandardCharsets.UTF_8);

        assertTrue(CALLBACK_REACHED.get(), "provider callback did not reach the harness return page");
        assertEquals("200", result.get("start"));
        assertEquals("200", result.get("login"));
        assertEquals("LOGIN", result.get("loginOutcome"));
        assertEquals("true", result.get("accessOnly"));
        assertEquals("true", result.get("loginAuthorizationOmitted"));
        assertEquals("true", result.get("callbackUrlClean"));
        assertEquals("200", result.get("refresh"));
        assertEquals("true", result.get("refreshAccessOnly"));
        assertEquals("204", result.get("logout"));
        assertEquals("401", result.get("afterLogout"));
        assertEquals("true", result.get("correlationHttpOnly"));
        assertEquals("true", result.get("refreshHttpOnly"));
        assertEquals("true", result.get("csrfVisible"));
        assertEquals("false", result.get("probeTimedOut"));
        assertEquals("true", result.get("preExchangeEmpty"));
        assertEquals("true", result.get("postExchangePersisted"));
    }

    private static void serveHarnessPage(HttpExchange exchange) throws IOException {
        if ("/auth/callback".equals(exchange.getRequestURI().getPath())) {
            CALLBACK_REACHED.set(true);
        }
        byte[] page;
        try (InputStream input = M3BrowserAcceptanceFixtureTest.class.getResourceAsStream(
                "/m3-browser-harness/index.html")) {
            if (input == null) {
                throw new IOException("browser harness resource is missing");
            }
            page = input.readAllBytes();
        }
        exchange.getResponseHeaders().set("Content-Type", "text/html; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(200, page.length);
        try (var output = exchange.getResponseBody()) {
            output.write(page);
        }
    }

    private static void receiveBrowserResult(HttpExchange exchange) throws IOException {
        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(405, -1);
            exchange.close();
            return;
        }
        byte[] body = readBounded(exchange.getRequestBody(), 8192);
        String value = new String(body, StandardCharsets.UTF_8);
        if (!value.matches("[a-zA-Z0-9=&_-]+")) {
            exchange.sendResponseHeaders(400, -1);
            exchange.close();
            return;
        }
        BROWSER_RESULT.set(value);
        exchange.sendResponseHeaders(204, -1);
        exchange.close();
    }

    private static void receiveBrowserState(HttpExchange exchange) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(405, -1);
            exchange.close();
            return;
        }
        JdbcTemplate database = DATABASE.get();
        if (database == null) {
            exchange.sendResponseHeaders(503, -1);
            exchange.close();
            return;
        }
        Integer users = database.queryForObject("select count(*) from identity.users", Integer.class);
        Integer sessions = database.queryForObject("select count(*) from identity.user_sessions", Integer.class);
        Integer oauthAccounts = database.queryForObject(
                "select count(*) from identity.oauth_accounts", Integer.class);
        String body = "{\"users\":" + users
                + ",\"sessions\":" + sessions
                + ",\"oauthAccounts\":" + oauthAccounts + "}";
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(200, bytes.length);
        try (var output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private static byte[] readBounded(InputStream input, int maximum) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[1024];
        int read;
        while ((read = input.read(buffer)) >= 0) {
            output.write(buffer, 0, read);
            if (output.size() > maximum) {
                throw new IOException("browser result exceeded bound");
            }
        }
        return output.toByteArray();
    }

    private static Map<String, String> parseResult(String body) {
        Map<String, String> result = new LinkedHashMap<>();
        for (String pair : body.split("&")) {
            String[] keyValue = pair.split("=", 2);
            result.put(
                    URLDecoder.decode(keyValue[0], StandardCharsets.UTF_8),
                    URLDecoder.decode(keyValue.length == 1 ? "" : keyValue[1], StandardCharsets.UTF_8));
        }
        return result;
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

    @TestConfiguration(proxyBeanMethods = false)
    static class CookieProbeConfiguration {

        @Bean
        @Order(0)
        SecurityFilterChain browserCookieProbeSecurity(HttpSecurity http) throws Exception {
            http
                    .securityMatcher("/auth/__m3/cookie-probe")
                    .csrf(AbstractHttpConfigurer::disable)
                    .authorizeHttpRequests(authorize -> authorize.anyRequest().permitAll())
                    .headers(headers -> headers.frameOptions(frame -> frame.disable()));
            return http.build();
        }

        @Bean
        CookieProbeController cookieProbeController() {
            return new CookieProbeController();
        }
    }

    @RestController
    static class CookieProbeController {

        @GetMapping(value = "/auth/__m3/cookie-probe", produces = MediaType.TEXT_HTML_VALUE)
        ResponseEntity<String> probe() {
            String body = "<!doctype html><script>window.parent.postMessage({type:'m3-cookie-probe',cookie:document.cookie},'"
                    + HARNESS_ORIGIN + "');</script>";
            return ResponseEntity.ok()
                    .contentType(MediaType.TEXT_HTML)
                    .header("Cache-Control", "no-store")
                    .body(body);
        }
    }
}
