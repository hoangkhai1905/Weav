package com.weav.workflow.infrastructure.http;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.domain.exception.ForbiddenException;
import org.junit.jupiter.api.Test;

import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HttpRequestNodeExecutorTest {

    private static final UUID WORKSPACE_ID = UUID.randomUUID();
    private static final UUID CONNECTION_ID = UUID.randomUUID();
    private static final UUID EXECUTION_ID = UUID.randomUUID();
    private static final UUID NODE_EXECUTION_ID = UUID.randomUUID();

    @Test
    void returnsCanonicalOutputAndScrubsEchoedCredentialBeforeClosingHolder() {
        RecordingTransport transport = new RecordingTransport(
                new PinnedHttpTransport.HttpResponse(200,
                        Map.of("safe", "api-secret", "Authorization", "Bearer api-secret"), Map.of()), null);
        FakeWorkspace workspace = new FakeWorkspace(
                new ResolvedConnection("HTTP", "TOKEN", Map.of("token", "api-secret")));
        HttpRequestNodeExecutor executor = executor(transport, workspace);

        NodeExecutor.Result result = executor.execute(context(), Map.of(
                "method", "GET",
                "url", "https://api.example.test/resource",
                "connectionId", CONNECTION_ID.toString()));

        assertEquals(200, result.output().get("status"));
        Map<?, ?> data = (Map<?, ?>) result.output().get("data");
        assertEquals("[REDACTED]", data.get("safe"));
        assertFalse(data.containsKey("Authorization"));
        assertEquals("Bearer api-secret", transport.authenticationHeaders.get("Authorization"));
        assertThrows(IllegalStateException.class, workspace.resolved::auth);
    }

    @Test
    void failsClosedForWorkspaceApiKeyUntilTheResolvedContractProvidesHeaderName() {
        String secret = "api-key-secret-marker";
        RecordingTransport transport = new RecordingTransport(
                new PinnedHttpTransport.HttpResponse(200, Map.of("ok", true), Map.of()), null);
        FakeWorkspace workspace = new FakeWorkspace(
                new ResolvedConnection("HTTP", "API_KEY", Map.of("apiKey", secret)));
        HttpRequestNodeExecutor executor = executor(transport, workspace);

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> executor.execute(context(), Map.of(
                        "method", "GET",
                        "url", "https://api.example.test/resource",
                        "connectionId", CONNECTION_ID.toString())));

        assertEquals("DEPENDENCY_NOT_CONFIGURED", failure.code());
        assertFalse(failure.retryable());
        assertFalse(failure.getMessage().contains(secret));
        assertEquals(1, workspace.resolveCalls);
        assertEquals(0, workspace.reportCalls);
        assertFalse(transport.called);
        assertTrue(transport.authenticationHeaders.isEmpty());
        assertThrows(IllegalStateException.class, workspace.resolved::auth);
    }

    @Test
    void scrubsTheDerivedBasicAuthorizationValueFromEchoedResponseData() {
        String authorization = "Basic " + java.util.Base64.getEncoder().encodeToString(
                "workflow-user:basic-secret".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        RecordingTransport transport = new RecordingTransport(
                new PinnedHttpTransport.HttpResponse(200, Map.of("echo", authorization), Map.of()), null);
        FakeWorkspace workspace = new FakeWorkspace(
                new ResolvedConnection("HTTP", "BASIC", Map.of(
                        "username", "workflow-user", "password", "basic-secret")));
        HttpRequestNodeExecutor executor = executor(transport, workspace);

        NodeExecutor.Result result = executor.execute(context(), Map.of(
                "method", "GET",
                "url", "https://api.example.test/resource",
                "connectionId", CONNECTION_ID.toString()));

        Map<?, ?> data = (Map<?, ?>) result.output().get("data");
        assertEquals("[REDACTED]", data.get("echo"));
        assertEquals(authorization, transport.authenticationHeaders.get("Authorization"));
        assertThrows(IllegalStateException.class, workspace.resolved::auth);
    }

    @Test
    void rejectsInlineCredentialHeadersBeforeResolvingWorkspaceConnection() {
        RecordingTransport transport = new RecordingTransport(
                new PinnedHttpTransport.HttpResponse(200, Map.of("ok", true), Map.of()), null);
        FakeWorkspace workspace = new FakeWorkspace(
                new ResolvedConnection("HTTP", "TOKEN", Map.of("token", "secret")));
        HttpRequestNodeExecutor executor = executor(transport, workspace);

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> executor.execute(context(), Map.of(
                        "method", "GET",
                        "url", "https://api.example.test/resource",
                        "connectionId", CONNECTION_ID.toString(),
                        "headers", Map.of("X-Access-Token", "inline-secret"))));

        assertEquals("CONFIGURATION_ERROR", failure.code());
        assertEquals(0, workspace.resolveCalls);
        assertFalse(transport.called);
    }

    @Test
    void distinguishesConfirmedAuthRejectionRateLimitAndBusinessForbidden() {
        for (Case testCase : new Case[]{
                new Case(401, "AUTHENTICATION_REJECTED", false, true),
                new Case(403, "HTTP_BUSINESS_REJECTED", false, false),
                new Case(429, "HTTP_RATE_LIMITED", true, false)}) {
            RecordingTransport transport = new RecordingTransport(
                    new PinnedHttpTransport.HttpResponse(testCase.status(), Map.of("error", "secret"), Map.of()), null);
            FakeWorkspace workspace = new FakeWorkspace(
                    new ResolvedConnection("HTTP", "TOKEN", Map.of("token", "secret")));
            HttpRequestNodeExecutor executor = executor(transport, workspace);

            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor.execute(context(), Map.of(
                            "method", "GET",
                            "url", "https://api.example.test/resource",
                            "connectionId", CONNECTION_ID.toString())));

            assertEquals(testCase.code(), failure.code());
            assertEquals(testCase.retryable(), failure.retryable());
            assertEquals(testCase.reported(), workspace.reportCalls > 0);
        }
    }

    @Test
    void rejectsProviderAndAuthenticationModesOutsideHttpContract() {
        RecordingTransport transport = new RecordingTransport(
                new PinnedHttpTransport.HttpResponse(200, Map.of(), Map.of()), null);
        FakeWorkspace workspace = new FakeWorkspace(
                new ResolvedConnection("GOOGLE_SHEETS", "OAUTH2", Map.of("accessToken", "secret")));
        HttpRequestNodeExecutor executor = executor(transport, workspace);

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> executor.execute(context(), Map.of(
                        "method", "GET",
                        "url", "https://api.example.test/resource",
                        "connectionId", CONNECTION_ID.toString())));

        assertEquals("CONNECTION_CONFIGURATION_INVALID", failure.code());
        assertFalse(transport.called);
        assertThrows(IllegalStateException.class, workspace.resolved::auth);
    }

    @Test
    void mapsWorkspaceDenialAndUnavailableToSafeClassifications() {
        for (WorkspaceFailure failureType : WorkspaceFailure.values()) {
            RecordingTransport transport = new RecordingTransport(
                    new PinnedHttpTransport.HttpResponse(200, Map.of(), Map.of()), null);
            FakeWorkspace workspace = new FakeWorkspace(null);
            workspace.failure = failureType;
            HttpRequestNodeExecutor executor = executor(transport, workspace);

            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor.execute(context(), Map.of(
                            "method", "GET",
                            "url", "https://api.example.test/resource",
                            "connectionId", CONNECTION_ID.toString())));

            assertEquals(failureType == WorkspaceFailure.FORBIDDEN
                    ? "CONNECTION_FORBIDDEN" : "CONNECTION_UNAVAILABLE", failure.code());
            assertEquals(failureType == WorkspaceFailure.UNAVAILABLE, failure.retryable());
            assertFalse(failure.getMessage().contains("workspace-secret"));
        }
    }

    private static HttpRequestNodeExecutor executor(
            RecordingTransport transport, FakeWorkspace workspace) {
        OutboundTargetPolicy policy = new OutboundTargetPolicy(
                ignored -> new InetAddress[]{publicAddress()});
        return new HttpRequestNodeExecutor(policy, transport, workspace);
    }

    private static NodeExecutor.Context context() {
        return new NodeExecutor.Context(WORKSPACE_ID, EXECUTION_ID, NODE_EXECUTION_ID,
                "http-node", 1, "correlation-id", null);
    }

    private static InetAddress publicAddress() {
        try {
            return InetAddress.getByName("93.184.216.34");
        } catch (UnknownHostException exception) {
            throw new AssertionError(exception);
        }
    }

    private enum WorkspaceFailure {
        FORBIDDEN,
        UNAVAILABLE
    }

    private record Case(int status, String code, boolean retryable, boolean reported) {
    }

    private static final class RecordingTransport extends PinnedHttpTransport {
        private final HttpResponse response;
        private final RuntimeException failure;
        private Map<String, String> authenticationHeaders = Map.of();
        private boolean called;

        private RecordingTransport(HttpResponse response, RuntimeException failure) {
            super();
            this.response = response;
            this.failure = failure;
        }

        @Override
        HttpResponse executeWithAuthentication(
                OutboundTargetPolicy.ApprovedTarget target,
                String method,
                Map<String, String> headers,
                Map<String, String> authenticationHeaders,
                Object query,
                Object body) {
            called = true;
            this.authenticationHeaders = authenticationHeaders;
            if (failure != null) {
                throw failure;
            }
            return response;
        }
    }

    private static final class FakeWorkspace implements WorkspaceConnectionPort {
        private final ResolvedConnection resolved;
        private WorkspaceFailure failure;
        private int resolveCalls;
        private int reportCalls;

        private FakeWorkspace(ResolvedConnection resolved) {
            this.resolved = resolved;
        }

        @Override
        public void authorizeAttachment(UUID workspaceId, UUID connectionId, UUID userId) {
        }

        @Override
        public ResolvedConnection resolve(UUID workspaceId, UUID connectionId) {
            resolveCalls++;
            if (failure == WorkspaceFailure.FORBIDDEN) {
                throw new ForbiddenException();
            }
            if (failure == WorkspaceFailure.UNAVAILABLE) {
                throw new WorkspaceDependencyUnavailableException();
            }
            return resolved;
        }

        @Override
        public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
            reportCalls++;
        }
    }
}
