package com.weav.workspace.infrastructure.provider.llm;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.dto.ConnectionTestResult.ConnectionTestOutcome;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import com.weav.workspace.infrastructure.provider.http.HttpTargetValidator;
import com.weav.workspace.infrastructure.provider.http.PinnedHttpTransport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class LlmKeyConnectionProviderTest {

    private static final String KEY = "synthetic-llm-key-123";

    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void okResponseIsVerified() throws Exception {
        startServer(exchange -> respond(exchange, 200, "{\"data\":[]}"));
        assertEquals(ConnectionTestOutcome.VERIFIED,
                provider(ConnectionProvider.OPENAI).test(connection(ConnectionProvider.OPENAI), creds()).outcome());
    }

    @Test
    void rejectedKeyIsAuthInvalid() throws Exception {
        for (int status : List.of(401, 403)) {
            startServer(exchange -> respond(exchange, status, "{\"error\":\"nope\"}"));
            assertEquals(ConnectionTestOutcome.AUTH_INVALID,
                    provider(ConnectionProvider.ANTHROPIC).test(
                            connection(ConnectionProvider.ANTHROPIC), creds()).outcome());
            stopFixture();
        }
    }

    @Test
    void transientFailuresAreDependencyFailures() throws Exception {
        for (int status : List.of(408, 429, 500, 503)) {
            startServer(exchange -> respond(exchange, status, "synthetic body " + KEY));
            ConnectionTestResult result = provider(ConnectionProvider.GEMINI).test(
                    connection(ConnectionProvider.GEMINI), creds());
            assertEquals(ConnectionTestOutcome.DEPENDENCY_FAILURE, result.outcome());
            assertFalse(result.toString().contains(KEY));
            stopFixture();
        }
    }

    @Test
    void unreachableHostIsDependencyFailure() {
        assertEquals(ConnectionTestOutcome.DEPENDENCY_FAILURE,
                provider(ConnectionProvider.OPENAI).test(connection(ConnectionProvider.OPENAI), creds()).outcome());
    }

    @Test
    void sendsBearerForOpenAiAndGemini() throws Exception {
        for (ConnectionProvider p : List.of(ConnectionProvider.OPENAI, ConnectionProvider.GEMINI)) {
            AtomicReference<String> auth = new AtomicReference<>();
            AtomicReference<String> apiKey = new AtomicReference<>();
            startServer(exchange -> {
                auth.set(exchange.getRequestHeaders().getFirst("Authorization"));
                apiKey.set(exchange.getRequestHeaders().getFirst("x-api-key"));
                respond(exchange, 200, "{}");
            });
            provider(p).test(connection(p), creds());
            assertEquals("Bearer " + KEY, auth.get());
            assertNull(apiKey.get());
            stopFixture();
        }
    }

    @Test
    void sendsApiKeyAndVersionForAnthropic() throws Exception {
        AtomicReference<String> auth = new AtomicReference<>();
        AtomicReference<String> apiKey = new AtomicReference<>();
        AtomicReference<String> version = new AtomicReference<>();
        startServer(exchange -> {
            auth.set(exchange.getRequestHeaders().getFirst("Authorization"));
            apiKey.set(exchange.getRequestHeaders().getFirst("x-api-key"));
            version.set(exchange.getRequestHeaders().getFirst("anthropic-version"));
            respond(exchange, 200, "{}");
        });
        provider(ConnectionProvider.ANTHROPIC).test(connection(ConnectionProvider.ANTHROPIC), creds());
        assertEquals(KEY, apiKey.get());
        assertEquals("2023-06-01", version.get());
        assertNull(auth.get());
    }

    @Test
    void malformedCredentialIsAuthInvalidWithoutRequest() {
        LlmKeyConnectionProvider provider = provider(ConnectionProvider.OPENAI);
        Connection connection = connection(ConnectionProvider.OPENAI);
        assertEquals(ConnectionTestOutcome.AUTH_INVALID,
                provider.test(connection, Map.of("token", "bad\r\nkey")).outcome());
        assertEquals(ConnectionTestOutcome.AUTH_INVALID, provider.test(connection, Map.of("token", " ")).outcome());
        assertEquals(ConnectionTestOutcome.AUTH_INVALID, provider.test(connection, Map.of()).outcome());
    }

    @Test
    void validateConfigRejectsConfigAndWrongAuthType() {
        LlmKeyConnectionProvider provider = provider(ConnectionProvider.OPENAI);
        provider.validateConfig(ConnectionAuthType.TOKEN, Map.of());
        assertThrows(RuntimeException.class, () -> provider.validateConfig(
                ConnectionAuthType.TOKEN, Map.of("baseUrl", "https://example.test")));
        assertThrows(RuntimeException.class, () -> provider.validateConfig(ConnectionAuthType.API_KEY, Map.of()));
    }

    @Test
    void reportsItsProviderAndRejectsMismatchedConnection() {
        LlmKeyConnectionProvider provider = provider(ConnectionProvider.GEMINI);
        assertEquals(ConnectionProvider.GEMINI, provider.provider());
        assertThrows(RuntimeException.class, () -> provider.test(connection(ConnectionProvider.OPENAI), creds()));
    }

    @Test
    void rejectsNonLlmProvider() {
        assertThrows(IllegalArgumentException.class, () -> provider(ConnectionProvider.HTTP));
    }

    private static Map<String, Object> creds() {
        return Map.of("token", KEY);
    }

    private LlmKeyConnectionProvider provider(ConnectionProvider p) {
        return new LlmKeyConnectionProvider(
                p,
                URI.create(baseUrl() + "/v1/models"),
                new HttpTargetValidator(true),
                new PinnedHttpTransport(Duration.ofSeconds(1), Duration.ofSeconds(1)));
    }

    private Connection connection(ConnectionProvider p) {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");
        return new Connection(
                UUID.fromString("30000000-0000-0000-0000-000000000001"),
                UUID.fromString("10000000-0000-0000-0000-000000000001"),
                UUID.fromString("20000000-0000-0000-0000-000000000001"),
                "AI fixture", p, ConnectionAuthType.TOKEN, ConnectionStatus.DISABLED,
                Map.of(), null, now, now);
    }

    private void startServer(Handler handler) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", handler::handle);
        server.start();
    }

    private String baseUrl() {
        return server == null ? "http://127.0.0.1:1" : "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private void stopFixture() {
        if (server != null) {
            server.stop(0);
            server = null;
        }
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length);
        try (var output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    @FunctionalInterface
    private interface Handler {
        void handle(HttpExchange exchange) throws IOException;
    }
}
