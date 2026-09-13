package com.weav.workspace.infrastructure.identity;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.model.IdentityUserSummary;
import com.weav.workspace.domain.query.SortDirection;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class IdentityDirectoryHttpClientTest {

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(2);
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(2);
    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void mapsEmailLookupAndInactiveStateFromRealHttp() throws Exception {
        UUID userId = UUID.randomUUID();
        startServer(exchange -> respond(exchange, 200, "{\"userId\":\"" + userId
                + "\",\"email\":\"inactive@example.com\",\"displayName\":null,\"active\":false}"));
        IdentityDirectoryHttpClient client = client();

        IdentityUserSummary result = client.findByEmail("inactive@example.com").orElseThrow();

        assertEquals(userId, result.userId());
        assertEquals("inactive@example.com", result.email());
        assertTrue(!result.active());
    }

    @Test
    void validatesEmailUsingIdentityRulesBeforeNetworkCall() throws Exception {
        AtomicInteger requests = new AtomicInteger();
        UUID userId = UUID.randomUUID();
        startServer(exchange -> {
            requests.incrementAndGet();
            respond(exchange, 200, "{\"userId\":\"" + userId
                    + "\",\"email\":\"mixed@example.com\",\"displayName\":null,\"active\":true}");
        });
        IdentityDirectoryHttpClient client = client();

        assertEquals(userId, client.findByEmail("  MiXeD@Example.COM ").orElseThrow().userId());
        assertEquals(1, requests.get());

        for (String email : List.of(
                "not-an-email",
                "user name@example.com",
                "usér@example.com",
                "a".repeat(321) + "@example.com")) {
            assertThrows(BadRequestException.class, () -> client.findByEmail(email));
        }

        assertEquals(1, requests.get(), "invalid email must fail before HTTP transport");
    }

    @Test
    void returnsEmptyForEmailNotFoundButMapsOtherClientErrorsSemantically() throws Exception {
        startServer(exchange -> respond(exchange, 404, "{}"));
        assertTrue(client().findByEmail("missing@example.com").isEmpty());

        for (int status : List.of(400, 401, 403, 404, 429)) {
            stopServer();
            int responseStatus = status;
            startServer(exchange -> respond(exchange, responseStatus, "downstream response"));
            RuntimeException exception = assertThrows(RuntimeException.class, () -> client().matchUserIds(
                    List.of(UUID.randomUUID()), "query"));
            if (status == 400) {
                assertInstanceOf(BadRequestException.class, exception);
            } else {
                assertInstanceOf(DependencyUnavailableException.class, exception);
            }
        }
    }

    @Test
    void timeoutAndServerFailureBecomeDependencyUnavailableWithoutPayloadLeak() throws Exception {
        startServer(exchange -> {
            try {
                Thread.sleep(250);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            respond(exchange, 200, "{}");
        });
        IdentityDirectoryProperties shortTimeout = new IdentityDirectoryProperties(
                URI.create(baseUrl()), Duration.ofSeconds(1), Duration.ofMillis(50), "test-key");
        IdentityDirectoryHttpClient timeoutClient = new IdentityDirectoryHttpClient(
                RestClient.builder().baseUrl(baseUrl()).build(), shortTimeout);
        assertInstanceOf(DependencyUnavailableException.class,
                assertThrows(DependencyUnavailableException.class,
                        () -> timeoutClient.findByEmail("timeout@example.com")));

        stopServer();
        startServer(exchange -> respond(exchange, 503, "sensitive downstream payload"));
        DependencyUnavailableException exception = assertThrows(
                DependencyUnavailableException.class,
                () -> client().matchUserIds(List.of(UUID.randomUUID()), "query"));
        assertTrue(!exception.getMessage().contains("sensitive"));
    }

    @Test
    void connectionRefusalBecomesDependencyUnavailable() {
        int closedPort = 1;
        IdentityDirectoryProperties properties = new IdentityDirectoryProperties(
                URI.create("http://127.0.0.1:" + closedPort), CONNECT_TIMEOUT, READ_TIMEOUT, "test-key");
        IdentityDirectoryHttpClient refusedClient = new IdentityDirectoryHttpClient(
                RestClient.builder().baseUrl(properties.baseUrl().toString()).build(), properties);

        assertInstanceOf(DependencyUnavailableException.class,
                assertThrows(DependencyUnavailableException.class,
                        () -> refusedClient.findByEmail("refused@example.com")));
    }

    @Test
    void chunksLargeCandidateAndBatchRequestsAndShortCircuitsEmptyInputs() throws Exception {
        AtomicInteger requests = new AtomicInteger();
        startServer(exchange -> {
            requests.incrementAndGet();
            String path = exchange.getRequestURI().getPath();
            if (path.endsWith("/match")) {
                respond(exchange, 200, "{\"matchingUserIds\":[]}");
            } else {
                respond(exchange, 200, "[]");
            }
        });
        IdentityDirectoryHttpClient client = client();
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < 501; i++) {
            ids.add(UUID.randomUUID());
        }

        assertTrue(client.matchUserIds(List.of(), "ignored").isEmpty());
        assertTrue(client.getUsersByIds(List.of()).isEmpty());
        client.matchUserIds(ids, "query");
        client.getUsersByIds(ids);

        assertEquals(4, requests.get(), "each 501-item operation must use two HTTP chunks");
    }

    @Test
    void mergesChunkPagesGloballyWithStableNullLastOrderingAndExactTotals() throws Exception {
        UUID first = UUID.fromString("00000000-0000-0000-0000-000000000001");
        UUID second = UUID.fromString("00000000-0000-0000-0000-000000000002");
        UUID third = UUID.fromString("00000000-0000-0000-0000-000000000003");
        AtomicInteger requests = new AtomicInteger();
        startServer(exchange -> {
            requests.incrementAndGet();
            String body = "{\"items\":["
                    + "{\"userId\":\"" + second + "\",\"email\":\"two@example.com\",\"displayName\":\"same\",\"active\":true},"
                    + "{\"userId\":\"" + first + "\",\"email\":\"one@example.com\",\"displayName\":\"Same\",\"active\":true},"
                    + "{\"userId\":\"" + third + "\",\"email\":\"three@example.com\",\"displayName\":null,\"active\":false}"
                    + "],\"page\":0,\"size\":100,\"totalElements\":3,\"totalPages\":1}";
            respond(exchange, 200, body);
        });
        IdentityDirectoryHttpClient client = client();

        var page = client.searchUsersByDisplayName(List.of(first, second, third), null, 0, 2, SortDirection.ASC);

        assertEquals(List.of(first, second), page.items().stream().map(IdentityUserSummary::userId).toList());
        assertEquals(3, page.totalElements());
        assertEquals(2, page.totalPages());
        assertEquals(1, requests.get());
    }

    private IdentityDirectoryHttpClient client() {
        IdentityDirectoryProperties properties = new IdentityDirectoryProperties(
                URI.create(baseUrl()), CONNECT_TIMEOUT, READ_TIMEOUT, "test-key");
        return new IdentityDirectoryHttpClient(RestClient.builder().baseUrl(baseUrl()).build(), properties);
    }

    private String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private void startServer(Handler handler) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/directory/users", handler::handle);
        server.start();
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
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
