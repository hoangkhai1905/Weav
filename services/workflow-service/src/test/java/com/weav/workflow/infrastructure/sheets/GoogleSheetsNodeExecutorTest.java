package com.weav.workflow.infrastructure.sheets;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.node.NodeExecutorRegistry;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GoogleSheetsNodeExecutorTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("c77f6cef-78ca-4840-910d-ed8ce8c519b2");
    private static final UUID CONNECTION_ID = UUID.fromString("988998bb-f44c-44a6-86c7-1dc568b9623f");
    private static final UUID EXECUTION_ID = UUID.fromString("df15a419-c85c-49ab-96a2-5e080e6e8fba");
    private static final UUID NODE_EXECUTION_ID = UUID.fromString("f9e79280-d645-4474-adb5-c29f91dd6492");
    private static final String ACCESS_TOKEN = "synthetic-google-access-token";

    @Test
    void executesReadAndSanitizesTheProviderJsonBeforeReturningIt() {
        FakeGoogleSheetsClient sheets = new FakeGoogleSheetsClient();
        sheets.readResult = Map.of(
                "range", "Sheet1!A1:B1",
                "Authorization", "Bearer " + ACCESS_TOKEN,
                "values", List.of(List.of("cell", ACCESS_TOKEN)));
        FakeWorkspace workspace = new FakeWorkspace(new ResolvedConnection(
                "GOOGLE_SHEETS", "OAUTH2", Map.of("accessToken", ACCESS_TOKEN)));
        GoogleSheetsNodeExecutor executor = new GoogleSheetsNodeExecutor(sheets, workspace);

        NodeExecutor.Result result = executor.execute(context(1), config("read", null));

        assertEquals("google.sheets", executor.type());
        assertEquals("sheet-id", sheets.spreadsheetId);
        assertEquals("Sheet1!A1:B1", sheets.range);
        assertEquals(ACCESS_TOKEN, sheets.tokenSeenByClient);
        assertEquals(WORKSPACE_ID, workspace.workspaceId);
        assertEquals(CONNECTION_ID, workspace.connectionId);
        assertEquals(1, workspace.resolveCalls);
        assertEquals(1, sheets.readCalls);
        Map<?, ?> output = result.output();
        assertEquals("Sheet1!A1:B1", output.get("range"));
        assertFalse(output.containsKey("Authorization"));
        assertFalse(output.toString().contains(ACCESS_TOKEN));
        List<?> returnedRow = (List<?>) ((List<?>) output.get("values")).getFirst();
        assertEquals("[REDACTED]", returnedRow.get(1));
        assertThrows(IllegalStateException.class, workspace.resolved::auth);
    }

    @Test
    void appendAndUpdatePreserveJsonCellTypesAndPassTheLiteralConnection() {
        for (String operation : List.of("append", "update")) {
            List<Object> row = new ArrayList<>(Arrays.asList("Ada", 7, false, null));
            List<List<Object>> values = List.of(row);
            FakeGoogleSheetsClient sheets = new FakeGoogleSheetsClient();
            FakeWorkspace workspace = new FakeWorkspace(new ResolvedConnection(
                    "GOOGLE_SHEETS", "OAUTH2", Map.of("accessToken", ACCESS_TOKEN)));
            GoogleSheetsNodeExecutor executor = new GoogleSheetsNodeExecutor(sheets, workspace);

            executor.execute(context(1), config(operation, values));

            assertEquals(1, workspace.resolveCalls);
            assertEquals(CONNECTION_ID, workspace.connectionId);
            assertEquals(values, sheets.values);
            assertSame(row.get(1), sheets.values.getFirst().get(1));
            assertSame(row.get(2), sheets.values.getFirst().get(2));
            assertEquals(operation.equals("append") ? 1 : 0, sheets.appendCalls);
            assertEquals(operation.equals("update") ? 1 : 0, sheets.updateCalls);
            assertThrows(IllegalStateException.class, workspace.resolved::auth);
        }
    }

    @Test
    void resolvesCredentialsAgainForEachRuntimeAttempt() {
        FakeGoogleSheetsClient sheets = new FakeGoogleSheetsClient();
        FakeWorkspace workspace = new FakeWorkspace(null);
        workspace.resolveByAttempt = true;
        GoogleSheetsNodeExecutor executor = new GoogleSheetsNodeExecutor(sheets, workspace);
        Map<String, Object> config = config("read", null);

        executor.execute(context(1), config);
        executor.execute(context(2), config);

        assertEquals(2, workspace.resolveCalls);
        assertEquals("attempt-token-1", sheets.tokensSeen.getFirst());
        assertEquals("attempt-token-2", sheets.tokensSeen.get(1));
        assertEquals(2, sheets.readCalls);
    }

    @Test
    void rejectsMissingOrNonLiteralConnectionAndUnknownOperationWithoutWorkspaceCalls() {
        FakeGoogleSheetsClient sheets = new FakeGoogleSheetsClient();
        FakeWorkspace workspace = new FakeWorkspace(new ResolvedConnection(
                "GOOGLE_SHEETS", "OAUTH2", Map.of("accessToken", ACCESS_TOKEN)));
        GoogleSheetsNodeExecutor executor = new GoogleSheetsNodeExecutor(sheets, workspace);

        assertConfigurationFailure(executor, Map.of(
                "operation", "read", "spreadsheetId", "sheet-id", "range", "Sheet1!A1"));
        assertConfigurationFailure(executor, Map.of(
                "connectionId", "{{ trigger.input.connectionId }}", "operation", "read",
                "spreadsheetId", "sheet-id", "range", "Sheet1!A1"));
        assertConfigurationFailure(executor, Map.of(
                "connectionId", CONNECTION_ID.toString(), "operation", "batchUpdate",
                "spreadsheetId", "sheet-id", "range", "Sheet1!A1"));

        assertEquals(0, workspace.resolveCalls);
        assertEquals(0, sheets.readCalls + sheets.appendCalls + sheets.updateCalls);
    }

    @Test
    void confirmedAuthenticationRejectionIsReportedAndConnectionIsClosed() {
        FakeGoogleSheetsClient sheets = new FakeGoogleSheetsClient();
        sheets.readFailure = new NodeExecutor.Failure(
                "AUTHENTICATION_REJECTED", "The Google provider rejected the credentials.", false);
        FakeWorkspace workspace = new FakeWorkspace(new ResolvedConnection(
                "GOOGLE_SHEETS", "OAUTH2", Map.of("accessToken", ACCESS_TOKEN)));
        GoogleSheetsNodeExecutor executor = new GoogleSheetsNodeExecutor(sheets, workspace);

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> executor.execute(context(1), config("read", null)));

        assertEquals("AUTHENTICATION_REJECTED", failure.code());
        assertFalse(failure.retryable());
        assertEquals(1, workspace.reportCalls);
        assertThrows(IllegalStateException.class, workspace.resolved::auth);
    }

    @Test
    void providerBusinessAndDependencyFailuresDoNotReportAuthenticationRejection() {
        for (NodeExecutor.Failure expected : List.of(
                new NodeExecutor.Failure("HTTP_BUSINESS_REJECTED", "The Google provider rejected the request.", false),
                new NodeExecutor.Failure("HTTP_RATE_LIMITED", "The Google provider rate limited the request.", true),
                new NodeExecutor.Failure("HTTP_DEPENDENCY_UNAVAILABLE", "The Google provider is unavailable.", true))) {
            FakeGoogleSheetsClient sheets = new FakeGoogleSheetsClient();
            sheets.readFailure = expected;
            FakeWorkspace workspace = new FakeWorkspace(new ResolvedConnection(
                    "GOOGLE_SHEETS", "OAUTH2", Map.of("accessToken", ACCESS_TOKEN)));
            GoogleSheetsNodeExecutor executor = new GoogleSheetsNodeExecutor(sheets, workspace);

            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor.execute(context(1), config("read", null)));

            assertEquals(expected.code(), failure.code());
            assertEquals(expected.retryable(), failure.retryable());
            assertEquals(0, workspace.reportCalls);
            assertThrows(IllegalStateException.class, workspace.resolved::auth);
        }
    }

    @Test
    void mapsWorkspaceDenialAndUnavailableToSafeFailures() {
        for (WorkspaceFailure kind : WorkspaceFailure.values()) {
            FakeGoogleSheetsClient sheets = new FakeGoogleSheetsClient();
            FakeWorkspace workspace = new FakeWorkspace(null);
            workspace.failure = kind;
            GoogleSheetsNodeExecutor executor = new GoogleSheetsNodeExecutor(sheets, workspace);

            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor.execute(context(1), config("read", null)));

            assertEquals(kind == WorkspaceFailure.FORBIDDEN
                    ? "CONNECTION_FORBIDDEN" : "CONNECTION_UNAVAILABLE", failure.code());
            assertEquals(kind == WorkspaceFailure.UNAVAILABLE, failure.retryable());
            assertFalse(failure.getMessage().contains("workspace-secret"));
            assertEquals(0, sheets.readCalls);
        }
    }

    @Test
    void googleSheetsExecutorIsDiscoveredThroughTheExistingNodeRegistry() {
        FakeWorkspace workspace = new FakeWorkspace(new ResolvedConnection(
                "GOOGLE_SHEETS", "OAUTH2", Map.of("accessToken", ACCESS_TOKEN)));
        try (AnnotationConfigApplicationContext application = new AnnotationConfigApplicationContext()) {
            application.registerBean(WorkspaceConnectionPort.class, () -> workspace);
            application.registerBean(PinnedHttpTransport.class, PinnedHttpTransport::new);
            application.register(NodeExecutorRegistry.class);
            application.scan("com.weav.workflow.infrastructure.sheets");
            application.refresh();

            GoogleSheetsNodeExecutor executor = application.getBean(GoogleSheetsNodeExecutor.class);
            NodeExecutorRegistry registry = application.getBean(NodeExecutorRegistry.class);

            assertSame(executor, registry.require("google.sheets"));
            assertTrue(GoogleSheetsNodeExecutor.class.isAnnotationPresent(org.springframework.stereotype.Component.class));
        }
    }

    private static void assertConfigurationFailure(GoogleSheetsNodeExecutor executor, Map<String, Object> config) {
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> executor.execute(context(1), config));
        assertEquals("CONFIGURATION_ERROR", failure.code());
        assertFalse(failure.retryable());
    }

    private static Map<String, Object> config(String operation, List<List<Object>> values) {
        var config = new java.util.LinkedHashMap<String, Object>();
        config.put("connectionId", CONNECTION_ID.toString());
        config.put("operation", operation);
        config.put("spreadsheetId", "sheet-id");
        config.put("range", "Sheet1!A1:B1");
        if (values != null) {
            config.put("values", values);
        }
        return config;
    }

    private static NodeExecutor.Context context(int attempt) {
        return new NodeExecutor.Context(WORKSPACE_ID, EXECUTION_ID, NODE_EXECUTION_ID,
                "sheets-node", attempt, "correlation-id", null);
    }

    private enum WorkspaceFailure {
        FORBIDDEN,
        UNAVAILABLE
    }

    private static final class FakeGoogleSheetsClient extends GoogleSheetsClient {
        private String spreadsheetId;
        private String range;
        private List<List<Object>> values;
        private String tokenSeenByClient;
        private final List<String> tokensSeen = new ArrayList<>();
        private int readCalls;
        private int appendCalls;
        private int updateCalls;
        private Map<String, Object> readResult = Map.of("values", List.of());
        private NodeExecutor.Failure readFailure;

        private FakeGoogleSheetsClient() {
            super(new PinnedHttpTransport());
        }

        @Override
        public Map<String, Object> read(String spreadsheetId, String range, ResolvedConnection connection) {
            readCalls++;
            capture(spreadsheetId, range, connection);
            if (readFailure != null) {
                throw readFailure;
            }
            return readResult;
        }

        @Override
        public Map<String, Object> append(
                String spreadsheetId, String range, List<List<Object>> values, ResolvedConnection connection) {
            appendCalls++;
            this.values = values;
            capture(spreadsheetId, range, connection);
            return Map.of("updatedRange", range);
        }

        @Override
        public Map<String, Object> update(
                String spreadsheetId, String range, List<List<Object>> values, ResolvedConnection connection) {
            updateCalls++;
            this.values = values;
            capture(spreadsheetId, range, connection);
            return Map.of("updatedRange", range);
        }

        private void capture(String spreadsheetId, String range, ResolvedConnection connection) {
            this.spreadsheetId = spreadsheetId;
            this.range = range;
            tokenSeenByClient = connection.auth().get("accessToken");
            tokensSeen.add(tokenSeenByClient);
        }
    }

    private static final class FakeWorkspace implements WorkspaceConnectionPort {
        private ResolvedConnection resolved;
        private WorkspaceFailure failure;
        private boolean resolveByAttempt;
        private UUID workspaceId;
        private UUID connectionId;
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
            this.workspaceId = workspaceId;
            this.connectionId = connectionId;
            resolveCalls++;
            if (failure == WorkspaceFailure.FORBIDDEN) {
                throw new ForbiddenException();
            }
            if (failure == WorkspaceFailure.UNAVAILABLE) {
                throw new WorkspaceDependencyUnavailableException();
            }
            if (resolveByAttempt) {
                resolved = new ResolvedConnection("GOOGLE_SHEETS", "OAUTH2",
                        Map.of("accessToken", "attempt-token-" + resolveCalls));
            }
            return resolved;
        }

        @Override
        public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
            reportCalls++;
        }
    }
}
