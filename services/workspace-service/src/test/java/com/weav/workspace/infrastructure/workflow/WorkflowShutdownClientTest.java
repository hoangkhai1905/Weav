package com.weav.workspace.infrastructure.workflow;

import com.sun.net.httpserver.HttpServer;
import com.weav.workspace.application.port.out.WorkflowShutdownPort;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.infrastructure.config.WorkflowServiceProperties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class WorkflowShutdownClientTest {

    private static final String KEY = "shutdown-test-service-key";

    private HttpServer server;

    @AfterEach
    void stop() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void postsToTheInternalRouteWithTheServiceKeyAndParsesTheCounts() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        AtomicReference<String> seen = new AtomicReference<>();
        start(200, "{\"paused\":3,\"alreadyPaused\":1,\"failedTelegramUnregister\":2,\"failed\":1}", seen);

        WorkflowShutdownPort.PauseAllResult result = client(KEY).pauseAll(workspaceId);

        assertEquals(new WorkflowShutdownPort.PauseAllResult(3, 1, 2, 1), result);
        assertEquals("POST /internal/workspaces/" + workspaceId + "/pause-all " + KEY, seen.get());
    }

    @Test
    void anyFailureIsDependencyUnavailable() throws Exception {
        start(500, "{}", new AtomicReference<>());
        assertThrows(DependencyUnavailableException.class, () -> client(KEY).pauseAll(UUID.randomUUID()));
        server.stop(0);

        start(200, "{\"paused\":-1,\"alreadyPaused\":0,\"failedTelegramUnregister\":0,\"failed\":0}", new AtomicReference<>());
        assertThrows(DependencyUnavailableException.class, () -> client(KEY).pauseAll(UUID.randomUUID()));
        server.stop(0);

        start(200, "not json", new AtomicReference<>());
        assertThrows(DependencyUnavailableException.class, () -> client(KEY).pauseAll(UUID.randomUUID()));
        server.stop(0);

        // a response without the failure count must never be read as "all paused"
        start(200, "{\"paused\":1,\"alreadyPaused\":0,\"failedTelegramUnregister\":0}", new AtomicReference<>());
        assertThrows(DependencyUnavailableException.class, () -> client(KEY).pauseAll(UUID.randomUUID()));
    }

    @Test
    void aMissingServiceKeyNeverCallsDownstream() throws Exception {
        AtomicReference<String> seen = new AtomicReference<>();
        start(200, "{\"paused\":0,\"alreadyPaused\":0,\"failedTelegramUnregister\":0,\"failed\":0}", seen);

        assertThrows(DependencyUnavailableException.class, () -> client("").pauseAll(UUID.randomUUID()));
        assertEquals(null, seen.get());
    }

    private WorkflowShutdownClient client(String key) {
        WorkflowServiceProperties properties = new WorkflowServiceProperties(
                URI.create("http://127.0.0.1:" + server.getAddress().getPort()),
                Duration.ofSeconds(1), Duration.ofSeconds(2), key);
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(1)).followRedirects(HttpClient.Redirect.NEVER).build());
        factory.setReadTimeout(Duration.ofSeconds(2));
        return new WorkflowShutdownClient(RestClient.builder().requestFactory(factory).build(), properties,
                new ObjectMapper(), WorkflowConnectionUsageClient.circuitBreaker(20, 50f, 10, Duration.ofSeconds(10), 3));
    }

    private void start(int status, String body, AtomicReference<String> seen) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            seen.set(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath() + " "
                    + exchange.getRequestHeaders().getFirst("X-Internal-Service-Key"));
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
    }
}
