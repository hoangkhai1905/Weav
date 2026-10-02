package com.weav.workspace.infrastructure.provider.http;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HttpConnectionProviderTest {

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
    void noneAuthVerifiesWithRealHttpAndDoesNotInjectAuthorization() throws Exception {
        AtomicReference<String> authorization = new AtomicReference<>();
        startServer(exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            respond(exchange, 204, "");
        });

        ConnectionTestResult result = provider(true).test(
                connection(ConnectionAuthType.NONE, Map.of("baseUrl", baseUrl(), "testPath", "/health")),
                Map.of());

        assertEquals(ConnectionTestResult.ConnectionTestOutcome.VERIFIED, result.outcome());
        assertEquals(null, authorization.get());
    }

    @Test
    void tokenBasicAndApiKeyAuthUseHeadersOnly() throws Exception {
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> apiKey = new AtomicReference<>();
        startServer(exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            apiKey.set(exchange.getRequestHeaders().getFirst("X-Api-Key"));
            respond(exchange, 200, "ok");
        });
        HttpConnectionProvider provider = provider(true);

        assertEquals(ConnectionTestResult.ConnectionTestOutcome.VERIFIED, provider.test(
                connection(ConnectionAuthType.TOKEN, Map.of("baseUrl", baseUrl(), "testPath", "/token")),
                Map.of("token", "token-fixture")).outcome());
        assertEquals("Bearer token-fixture", authorization.get());

        assertEquals(ConnectionTestResult.ConnectionTestOutcome.VERIFIED, provider.test(
                connection(ConnectionAuthType.BASIC, Map.of("baseUrl", baseUrl(), "testPath", "/basic")),
                Map.of("username", "user-fixture", "password", "password-fixture")).outcome());
        assertTrue(authorization.get().startsWith("Basic "));
        assertFalse(authorization.get().contains("password-fixture"));

        assertEquals(ConnectionTestResult.ConnectionTestOutcome.VERIFIED, provider.test(
                connection(ConnectionAuthType.API_KEY, Map.of(
                        "baseUrl", baseUrl(), "testPath", "/api-key", "apiKeyHeaderName", "X-Api-Key")),
                Map.of("apiKey", "api-key-fixture")).outcome());
        assertEquals("api-key-fixture", apiKey.get());
    }

    @Test
    void missingTestPathOnlyValidatesConfigAndDoesNotResolveOrCallNetwork() {
        AtomicInteger resolutions = new AtomicInteger();
        HttpTargetValidator validator = new HttpTargetValidator(host -> {
            resolutions.incrementAndGet();
            return new java.net.InetAddress[] {java.net.InetAddress.getLoopbackAddress()};
        }, false);
        HttpConnectionProvider provider = new HttpConnectionProvider(
                validator, new PinnedHttpTransport(Duration.ofMillis(100), Duration.ofMillis(100)));

        ConnectionTestResult result = provider.test(
                connection(ConnectionAuthType.NONE, Map.of("baseUrl", "https://api.example.test")),
                Map.of());

        assertEquals(ConnectionTestResult.ConnectionTestOutcome.VERIFIED, result.outcome());
        assertEquals(ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID, provider.test(
                connection(ConnectionAuthType.TOKEN, Map.of("baseUrl", "https://api.example.test")),
                Map.of()).outcome());
        assertEquals(0, resolutions.get());
    }

    @Test
    void classifiesAuthAndTransientHttpResponses() throws Exception {
        HttpConnectionProvider provider = provider(true);
        for (int status : List.of(401, 403)) {
            startServer(exchange -> respond(exchange, status, "rejected-fixture"));
            assertEquals(ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID, provider.test(
                    connection(ConnectionAuthType.NONE, Map.of("baseUrl", baseUrl(), "testPath", "/health")),
                    Map.of()).outcome());
            stopFixture();
        }
        for (int status : List.of(400, 404, 405)) {
            startServer(exchange -> respond(exchange, status, "request-fixture"));
            assertEquals(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE, provider.test(
                    connection(ConnectionAuthType.NONE, Map.of("baseUrl", baseUrl(), "testPath", "/health")),
                    Map.of()).outcome());
            stopFixture();
        }
        for (int status : List.of(408, 429, 500, 503)) {
            startServer(exchange -> respond(exchange, status, "transient-fixture"));
            assertEquals(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE, provider.test(
                    connection(ConnectionAuthType.NONE, Map.of("baseUrl", baseUrl(), "testPath", "/health")),
                    Map.of()).outcome());
            stopFixture();
        }
    }

    @Test
    void joinsConfiguredBasePathAndPreservesQueryAndTrailingSlash() throws Exception {
        AtomicReference<String> requestedUri = new AtomicReference<>();
        startServer(exchange -> {
            requestedUri.set(exchange.getRequestURI().toString());
            respond(exchange, 200, "ok");
        });

        HttpConnectionProvider provider = provider(true);
        assertEquals(ConnectionTestResult.ConnectionTestOutcome.VERIFIED, provider.test(
                connection(ConnectionAuthType.NONE, Map.of(
                        "baseUrl", baseUrl() + "/api/v1",
                        "testPath", "/health?probe=1&mode=full")),
                Map.of()).outcome());
        assertEquals("/api/v1/health?probe=1&mode=full", requestedUri.get());

        stopFixture();
        startServer(exchange -> {
            requestedUri.set(exchange.getRequestURI().toString());
            respond(exchange, 200, "ok");
        });
        assertEquals(ConnectionTestResult.ConnectionTestOutcome.VERIFIED, provider.test(
                connection(ConnectionAuthType.NONE, Map.of(
                        "baseUrl", baseUrl() + "/api/v1/",
                        "testPath", "/health/")),
                Map.of()).outcome());
        assertEquals("/api/v1/health/", requestedUri.get());
    }

    @Test
    void redirectsAreNotFollowed() throws Exception {
        AtomicInteger redirectedRequests = new AtomicInteger();
        startServer(exchange -> {
            if (exchange.getRequestURI().getPath().equals("/health")) {
                exchange.getResponseHeaders().set("Location", "/redirected");
                respond(exchange, 302, "");
            } else {
                redirectedRequests.incrementAndGet();
                respond(exchange, 200, "unexpected");
            }
        });

        ConnectionTestResult result = provider(true).test(
                connection(ConnectionAuthType.NONE, Map.of("baseUrl", baseUrl(), "testPath", "/health")),
                Map.of());

        assertEquals(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE, result.outcome());
        assertEquals(0, redirectedRequests.get());
    }

    @Test
    void timeoutAndOversizedBodiesAreTransientDependencyFailures() throws Exception {
        startServer(exchange -> {
            try {
                Thread.sleep(200);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            respond(exchange, 200, "late");
        });
        HttpConnectionProvider shortTimeout = new HttpConnectionProvider(
                new HttpTargetValidator(true),
                new PinnedHttpTransport(Duration.ofSeconds(1), Duration.ofMillis(50)));
        assertEquals(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE, shortTimeout.test(
                connection(ConnectionAuthType.NONE, Map.of("baseUrl", baseUrl(), "testPath", "/slow")),
                Map.of()).outcome());
        stopFixture();

        startServer(exchange -> respond(exchange, 200, "x".repeat(PinnedHttpTransport.MAX_RESPONSE_BODY_BYTES + 1)));
        assertEquals(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE, provider(true).test(
                connection(ConnectionAuthType.NONE, Map.of("baseUrl", baseUrl(), "testPath", "/large")),
                Map.of()).outcome());
    }

    @Test
    void rejectsUnsafeTargetsAndInvalidAuthConfigurationBeforeNetwork() throws Exception {
        AtomicInteger requests = new AtomicInteger();
        startServer(exchange -> {
            requests.incrementAndGet();
            respond(exchange, 200, "unexpected");
        });

        HttpConnectionProvider productionProvider = new HttpConnectionProvider(
                new HttpTargetValidator(false),
                new PinnedHttpTransport(Duration.ofSeconds(1), Duration.ofSeconds(1)));
        assertThrows(BadRequestException.class, () -> productionProvider.test(
                connection(ConnectionAuthType.NONE, Map.of("baseUrl", baseUrl(), "testPath", "/health")),
                Map.of()));
        assertEquals(0, requests.get());

        HttpConnectionProvider localProvider = provider(true);
        for (Map<String, Object> config : List.of(
                Map.<String, Object>of("baseUrl", "https://user:password@api.example.test", "testPath", "/health"),
                Map.<String, Object>of("baseUrl", "https://api.example.test?apiKey=secret", "testPath", "/health"),
                Map.<String, Object>of("baseUrl", baseUrl(), "testPath", "//other.example.test/health"),
                Map.<String, Object>of("baseUrl", baseUrl() + "/api/v1", "testPath", "/../admin"),
                Map.<String, Object>of("baseUrl", baseUrl() + "/api/v1", "testPath", "/%2e%2e/admin"),
                Map.<String, Object>of("baseUrl", baseUrl() + "/api/../v1", "testPath", "/health"),
                Map.<String, Object>of("baseUrl", baseUrl(), "testPath", "/health", "apiKeyHeaderName", "Authorization"))) {
            assertThrows(BadRequestException.class, () -> localProvider.validateConfig(
                    ConnectionAuthType.API_KEY, config));
        }
        assertThrows(BadRequestException.class, () -> localProvider.validateConfig(
                ConnectionAuthType.OAUTH2, Map.of("baseUrl", baseUrl())));
    }

    @Test
    void dnsFailureIsClassifiedAsDependencyFailure() {
        HttpConnectionProvider provider = new HttpConnectionProvider(
                new HttpTargetValidator(host -> {
                    throw new UnknownHostException("synthetic-host");
                }, false),
                new PinnedHttpTransport(Duration.ofSeconds(1), Duration.ofSeconds(1)));

        ConnectionTestResult result = provider.test(
                connection(ConnectionAuthType.NONE, Map.of(
                        "baseUrl", "https://api.example.test",
                        "testPath", "/health")),
                Map.of());

        assertEquals(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE, result.outcome());
    }

    @Test
    void resolvesOnceAndPinsTheValidatedAddressForTheActualSocket() throws Exception {
        startServer(exchange -> respond(exchange, 200, "ok"));
        AtomicInteger resolutions = new AtomicInteger();
        HttpTargetValidator validator = new HttpTargetValidator(host -> {
            resolutions.incrementAndGet();
            return new InetAddress[] {InetAddress.getByName("127.0.0.1")};
        }, true);
        HttpConnectionProvider provider = new HttpConnectionProvider(
                validator,
                new PinnedHttpTransport(Duration.ofSeconds(1), Duration.ofSeconds(1)));

        ConnectionTestResult result = provider.test(
                connection(ConnectionAuthType.NONE, Map.of(
                        "baseUrl", "http://api.example.test:" + server.getAddress().getPort(),
                        "testPath", "/health")),
                Map.of());

        assertEquals(ConnectionTestResult.ConnectionTestOutcome.VERIFIED, result.outcome());
        assertEquals(1, resolutions.get());
    }

    @Test
    void rejectsCredentialsThatCouldEscapeTheSupportedShape() throws Exception {
        startServer(exchange -> respond(exchange, 200, "ok"));
        HttpConnectionProvider provider = provider(true);
        Connection connection = connection(
                ConnectionAuthType.TOKEN,
                Map.of("baseUrl", baseUrl(), "testPath", "/health"));

        assertEquals(ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID, provider.test(
                connection, Map.of("token", "token", "extra", "fixture")).outcome());
        assertEquals(ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID, provider.test(
                connection, Map.of()).outcome());
    }

    private HttpConnectionProvider provider(boolean allowLoopback) {
        return new HttpConnectionProvider(
                new HttpTargetValidator(allowLoopback),
                new PinnedHttpTransport(Duration.ofSeconds(1), Duration.ofSeconds(1)));
    }

    private Connection connection(ConnectionAuthType authType, Map<String, Object> config) {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");
        return new Connection(
                CONNECTION,
                WORKSPACE,
                CREATOR,
                "HTTP fixture",
                ConnectionProvider.HTTP,
                authType,
                ConnectionStatus.DISABLED,
                config,
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
