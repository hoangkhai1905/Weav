package com.weav.workspace.infrastructure.provider.telegram;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.weav.workspace.application.dto.ConnectionTestResult;
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
import static org.junit.jupiter.api.Assertions.assertThrows;

class TelegramConnectionProviderTest {

    private static final UUID WORKSPACE = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID CREATOR = UUID.fromString("20000000-0000-0000-0000-000000000001");
    private static final UUID CONNECTION = UUID.fromString("30000000-0000-0000-0000-000000000001");

    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void successfulGetMeResponseIsVerifiedAndUsesTheExpectedPath() throws Exception {
        AtomicReference<String> path = new AtomicReference<>();
        startServer(exchange -> {
            path.set(exchange.getRequestURI().getPath());
            respond(exchange, 200, "{\"ok\":true,\"result\":{\"id\":1}}");
        });

        ConnectionTestResult result = provider().test(connection(), Map.of("token", "12345:synthetic-token"));

        assertEquals(ConnectionTestResult.ConnectionTestOutcome.VERIFIED, result.outcome());
        assertEquals("/bot12345:synthetic-token/getMe", path.get());
    }

    @Test
    void confirmedBadTokenResponsesAreAuthInvalid() throws Exception {
        for (int status : List.of(401, 404)) {
            startServer(exchange -> respond(exchange, status, "{\"ok\":false,\"description\":\"rejected\"}"));
            assertEquals(ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID, provider().test(
                    connection(), Map.of("token", "synthetic-bad-token")).outcome());
            stopFixture();
        }

        startServer(exchange -> respond(exchange, 200,
                "{\"ok\":false,\"error_code\":401,\"description\":\"bad token\"}"));
        assertEquals(ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID, provider().test(
                connection(), Map.of("token", "synthetic-bad-token")).outcome());
    }

    @Test
    void unknownTelegramErrorsRemainDependencyFailures() throws Exception {
        startServer(exchange -> respond(exchange, 400,
                "{\"ok\":false,\"error_code\":400,\"description\":\"request error\"}"));
        assertEquals(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE, provider().test(
                connection(), Map.of("token", "synthetic-token")).outcome());

        stopFixture();
        startServer(exchange -> respond(exchange, 200,
                "{\"ok\":false,\"description\":\"unknown error\"}"));
        assertEquals(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE, provider().test(
                connection(), Map.of("token", "synthetic-token")).outcome());

        stopFixture();
        startServer(exchange -> respond(exchange, 400,
                "{\"ok\":false,\"error_code\":404,\"description\":\"bad token\"}"));
        assertEquals(ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID, provider().test(
                connection(), Map.of("token", "synthetic-token")).outcome());
    }

    @Test
    void transientTelegramFailuresAreDependencyFailures() throws Exception {
        for (int status : List.of(408, 429, 500, 503)) {
            startServer(exchange -> respond(exchange, status, "synthetic downstream body"));
            assertEquals(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE, provider().test(
                    connection(), Map.of("token", "synthetic-token")).outcome());
            stopFixture();
        }

        startServer(exchange -> {
            try {
                Thread.sleep(200);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            respond(exchange, 200, "{\"ok\":true}");
        });
        TelegramConnectionProvider shortTimeout = new TelegramConnectionProvider(
                URI.create(baseUrl()),
                new HttpTargetValidator(true),
                new PinnedHttpTransport(Duration.ofSeconds(1), Duration.ofMillis(50)),
                new tools.jackson.databind.ObjectMapper());
        assertEquals(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE, shortTimeout.test(
                connection(), Map.of("token", "synthetic-timeout-token")).outcome());
    }

    @Test
    void malformedSuccessBodyIsDependencyFailureWithoutTokenBearingException() throws Exception {
        startServer(exchange -> respond(exchange, 200, "not-json"));

        ConnectionTestResult result = provider().test(
                connection(), Map.of("token", "synthetic-token-without-log"));

        assertEquals(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE, result.outcome());
        assertFalse(result.toString().contains("synthetic-token-without-log"));
    }

    @Test
    void trailingOrDuplicateSuccessJsonIsDependencyFailure() throws Exception {
        startServer(exchange -> respond(exchange, 200, "{\"ok\":true}{\"ok\":false}"));

        ConnectionTestResult trailing = provider().test(
                connection(), Map.of("token", "synthetic-trailing-token"));

        assertEquals(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE, trailing.outcome());

        stopFixture();
        startServer(exchange -> respond(exchange, 200, "{\"ok\":true,\"ok\":false}"));
        ConnectionTestResult duplicate = provider().test(
                connection(), Map.of("token", "synthetic-duplicate-token"));
        assertEquals(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE, duplicate.outcome());
    }

    @Test
    void rejectsWrongAuthTypeAndUnexpectedConfig() {
        TelegramConnectionProvider provider = provider();
        assertThrows(RuntimeException.class, () -> provider.validateConfig(
                ConnectionAuthType.BASIC, Map.of()));
        assertThrows(RuntimeException.class, () -> provider.validateConfig(
                ConnectionAuthType.TOKEN, Map.of("baseUrl", "https://example.test")));
    }

    private TelegramConnectionProvider provider() {
        return new TelegramConnectionProvider(
                URI.create(baseUrl()),
                new HttpTargetValidator(true),
                new PinnedHttpTransport(Duration.ofSeconds(1), Duration.ofSeconds(1)),
                new tools.jackson.databind.ObjectMapper());
    }

    private Connection connection() {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");
        return new Connection(
                CONNECTION,
                WORKSPACE,
                CREATOR,
                "Telegram fixture",
                ConnectionProvider.TELEGRAM,
                ConnectionAuthType.TOKEN,
                ConnectionStatus.DISABLED,
                Map.of(),
                null,
                now,
                now);
    }

    private void startServer(Handler handler) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> handler.handle(exchange));
        server.start();
    }

    private String baseUrl() {
        if (server == null) {
            return "http://127.0.0.1:1";
        }
        return "http://127.0.0.1:" + server.getAddress().getPort();
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
