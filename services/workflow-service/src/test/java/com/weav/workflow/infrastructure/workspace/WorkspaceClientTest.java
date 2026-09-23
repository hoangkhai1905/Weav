package com.weav.workflow.infrastructure.workspace;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.application.service.WorkspaceAuthorization;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.infrastructure.web.CorrelationIdFilter;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.slf4j.MDC;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(OutputCaptureExtension.class)
class WorkspaceClientTest {

    private static final String SERVICE_KEY = "workflow-test-internal-service-key";
    private static final UUID WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000001");
    private static final UUID CONNECTION_ID = UUID.fromString("30000000-0000-0000-0000-000000000001");

    private final AtomicReference<RecordedRequest> lastRequest = new AtomicReference<>();
    private final AtomicReference<StubResponse> stubResponse = new AtomicReference<>(
            new StubResponse(200, "{}", false, 0));

    private HttpServer server;
    private ExecutorService executor;
    private WorkspaceClient client;
    private String baseUrl;

    @BeforeEach
    void startWorkspaceContractServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        executor = Executors.newCachedThreadPool();
        server.setExecutor(executor);
        server.createContext("/", this::handleRequest);
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        client = newClient(Duration.ofSeconds(2), SERVICE_KEY);
    }

    @AfterEach
    void stopWorkspaceContractServer() {
        MDC.remove(CorrelationIdFilter.MDC_KEY);
        if (server != null) {
            server.stop(0);
        }
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    @Test
    void getAccessUsesInternalKeyAndToleratesUnknownFutureCapabilities() {
        stubResponse.set(new StubResponse(200, accessResponse(WORKSPACE_ID, USER_ID,
                "OWNER", "WORKSPACE_VIEW", "WORKFLOW_PUBLISH", "FUTURE_CAPABILITY"), false, 0));
        MDC.put(CorrelationIdFilter.MDC_KEY, "workspace-client-42");

        WorkspaceAccessPort.Access access = client.getAccess(WORKSPACE_ID, USER_ID);

        assertEquals(WORKSPACE_ID, access.workspaceId());
        assertEquals(USER_ID, access.userId());
        assertEquals("OWNER", access.role());
        assertEquals(Set.of("WORKSPACE_VIEW", "WORKFLOW_PUBLISH", "FUTURE_CAPABILITY"), access.capabilities());
        assertEquals("GET", lastRequest.get().method());
        assertEquals("/internal/workspaces/" + WORKSPACE_ID + "/users/" + USER_ID + "/access",
                lastRequest.get().path());
        assertEquals("", lastRequest.get().body());
        assertEquals(SERVICE_KEY, lastRequest.get().serviceKey());
        assertEquals("workspace-client-42", lastRequest.get().correlationId());
    }

    @Test
    void accessResponseMustMatchRequestedWorkspaceAndUser() {
        UUID otherWorkspace = UUID.fromString("10000000-0000-0000-0000-000000000099");
        stubResponse.set(new StubResponse(200,
                accessResponse(otherWorkspace, USER_ID, "OWNER", "WORKSPACE_VIEW"), false, 0));

        assertThrows(WorkspaceDependencyUnavailableException.class,
                () -> client.getAccess(WORKSPACE_ID, USER_ID));

        UUID otherUser = UUID.fromString("20000000-0000-0000-0000-000000000099");
        stubResponse.set(new StubResponse(200,
                accessResponse(WORKSPACE_ID, otherUser, "OWNER", "WORKSPACE_VIEW"), false, 0));

        assertThrows(WorkspaceDependencyUnavailableException.class,
                () -> client.getAccess(WORKSPACE_ID, USER_ID));
    }

    @Test
    void malformedAccessResponseDeniesAuthorization() {
        stubResponse.set(new StubResponse(200, "{\"workspaceId\":\"" + WORKSPACE_ID + "\"}", false, 0));
        WorkspaceAuthorization authorization = new WorkspaceAuthorization(client);

        assertThrows(WorkspaceDependencyUnavailableException.class,
                () -> authorization.require(WORKSPACE_ID, USER_ID, "WORKSPACE_VIEW"));
    }

    @Test
    void accessTimeoutDeniesAuthorizationWithoutLoggingTheKeyOrDownstreamBody(CapturedOutput output) {
        stubResponse.set(new StubResponse(200,
                "{\"diagnostic\":\"raw-downstream-marker\"}", false, 500));
        WorkspaceClient shortTimeoutClient = newClient(Duration.ofMillis(100), SERVICE_KEY);
        WorkspaceAuthorization authorization = new WorkspaceAuthorization(shortTimeoutClient);

        WorkspaceDependencyUnavailableException error = assertThrows(
                WorkspaceDependencyUnavailableException.class,
                () -> authorization.require(WORKSPACE_ID, USER_ID, "WORKSPACE_VIEW"));

        assertFalse(error.getMessage().contains(SERVICE_KEY));
        assertFalse(error.getMessage().contains("raw-downstream-marker"));
        assertFalse(output.getOut().contains(SERVICE_KEY));
        assertFalse(output.getOut().contains("raw-downstream-marker"));
        assertTrue(lastRequest.get() != null);
    }

    @Test
    void missingAccessSnapshotIsDeniedAsForbidden() {
        stubResponse.set(new StubResponse(404, "{\"message\":\"private workspace details\"}", false, 0));

        assertThrows(ForbiddenException.class, () -> client.getAccess(WORKSPACE_ID, USER_ID));
    }

    @Test
    void authorizeAttachmentPostsTheRequestedUserToTheDocumentedRoute() {
        stubResponse.set(new StubResponse(204, "", false, 0));

        assertDoesNotThrow(() -> client.authorizeAttachment(WORKSPACE_ID, CONNECTION_ID, USER_ID));

        assertEquals("POST", lastRequest.get().method());
        assertEquals("/internal/workspaces/" + WORKSPACE_ID + "/connections/" + CONNECTION_ID
                + "/authorize-attachment", lastRequest.get().path());
        assertEquals("{\"userId\":\"" + USER_ID + "\"}", lastRequest.get().body());
        assertEquals(SERVICE_KEY, lastRequest.get().serviceKey());
    }

    @Test
    void deniedAttachmentDoesNotPassThroughWorkspaceResponse() {
        stubResponse.set(new StubResponse(403,
                "{\"message\":\"connection owner details must not escape\"}", false, 0));

        ForbiddenException error = assertThrows(ForbiddenException.class,
                () -> client.authorizeAttachment(WORKSPACE_ID, CONNECTION_ID, USER_ID));

        assertFalse(error.getMessage().contains("connection owner details"));
    }

    @Test
    void resolveUsesNoBodyRequiresNoStoreAndReturnsRedactedCloseableCredentials() {
        stubResponse.set(new StubResponse(200,
                "{\"provider\":\"GOOGLE_SHEETS\",\"authType\":\"OAUTH2\","
                        + "\"auth\":{\"accessToken\":\"access-token-secret\"}}",
                true, 0));

        ResolvedConnection resolved = client.resolve(WORKSPACE_ID, CONNECTION_ID);
        Map<String, String> auth = resolved.auth();

        assertEquals("GOOGLE_SHEETS", resolved.provider());
        assertEquals("OAUTH2", resolved.authType());
        assertEquals("access-token-secret", auth.get("accessToken"));
        assertEquals("POST", lastRequest.get().method());
        assertEquals("/internal/workspaces/" + WORKSPACE_ID + "/connections/" + CONNECTION_ID + "/resolve",
                lastRequest.get().path());
        assertEquals("", lastRequest.get().body());
        assertFalse(resolved.toString().contains("access-token-secret"));
        assertFalse(java.io.Serializable.class.isAssignableFrom(ResolvedConnection.class));

        resolved.close();

        assertTrue(auth.isEmpty());
        assertThrows(IllegalStateException.class, resolved::auth);
    }

    @Test
    void resolveRejectsCacheableResponsesAndRefreshTokens() {
        stubResponse.set(new StubResponse(200,
                "{\"provider\":\"GOOGLE_SHEETS\",\"authType\":\"OAUTH2\","
                        + "\"auth\":{\"accessToken\":\"access-token-secret\"}}",
                false, 0));

        assertThrows(WorkspaceDependencyUnavailableException.class,
                () -> client.resolve(WORKSPACE_ID, CONNECTION_ID));

        stubResponse.set(new StubResponse(200,
                "{\"provider\":\"GOOGLE_SHEETS\",\"authType\":\"OAUTH2\","
                        + "\"auth\":{\"accessToken\":\"access-token-secret\","
                        + "\"refreshToken\":\"refresh-token-secret\"}}",
                true, 0));

        assertThrows(WorkspaceDependencyUnavailableException.class,
                () -> client.resolve(WORKSPACE_ID, CONNECTION_ID));
    }

    @Test
    void authFailureReportsOnlyTheConfirmedAuthenticationRejection() {
        stubResponse.set(new StubResponse(204, "", false, 0));

        client.reportAuthenticationRejected(WORKSPACE_ID, CONNECTION_ID);

        assertEquals("POST", lastRequest.get().method());
        assertEquals("/internal/workspaces/" + WORKSPACE_ID + "/connections/" + CONNECTION_ID
                + "/auth-failure", lastRequest.get().path());
        assertEquals("{\"failureCode\":\"AUTHENTICATION_REJECTED\"}", lastRequest.get().body());
    }

    @Test
    void missingInternalKeyFailsClosedBeforeSendingARequest() {
        WorkspaceClient noKeyClient = newClient(Duration.ofSeconds(1), "");

        assertThrows(WorkspaceDependencyUnavailableException.class,
                () -> noKeyClient.getAccess(WORKSPACE_ID, USER_ID));
        assertNull(lastRequest.get());
    }

    private WorkspaceClient newClient(Duration readTimeout, String internalServiceKey) {
        WorkspaceClientProperties properties = new WorkspaceClientProperties(
                URI.create(baseUrl), Duration.ofSeconds(1), readTimeout, internalServiceKey);
        return new WorkspaceClient(properties, new ObjectMapper());
    }

    private String accessResponse(UUID workspaceId, UUID userId, String role, String... capabilities) {
        String values = java.util.Arrays.stream(capabilities)
                .map(value -> "\"" + value + "\"")
                .collect(java.util.stream.Collectors.joining(","));
        return "{\"workspaceId\":\"" + workspaceId + "\",\"userId\":\"" + userId
                + "\",\"role\":\"" + role + "\",\"capabilities\":[" + values + "]}";
    }

    private void handleRequest(HttpExchange exchange) throws IOException {
        byte[] requestBytes = exchange.getRequestBody().readAllBytes();
        lastRequest.set(new RecordedRequest(
                exchange.getRequestMethod(),
                exchange.getRequestURI().getPath(),
                new String(requestBytes, StandardCharsets.UTF_8),
                exchange.getRequestHeaders().getFirst("X-Internal-Service-Key"),
                exchange.getRequestHeaders().getFirst(CorrelationIdFilter.HEADER_NAME)));

        StubResponse stub = stubResponse.get();
        if (stub.delayMillis() > 0) {
            try {
                Thread.sleep(stub.delayMillis());
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                exchange.close();
                return;
            }
        }
        if (stub.noStore()) {
            exchange.getResponseHeaders().set("Cache-Control", "no-store");
        }
        byte[] responseBytes = stub.body().getBytes(StandardCharsets.UTF_8);
        try {
            if (responseBytes.length == 0 || stub.status() == 204) {
                exchange.sendResponseHeaders(stub.status(), -1);
            } else {
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(stub.status(), responseBytes.length);
                exchange.getResponseBody().write(responseBytes);
            }
        } catch (IOException ignored) {
            // The timeout test closes the client side before the delayed stub responds.
        } finally {
            exchange.close();
        }
    }

    private record StubResponse(int status, String body, boolean noStore, long delayMillis) {
    }

    private record RecordedRequest(String method, String path, String body, String serviceKey, String correlationId) {
    }
}
