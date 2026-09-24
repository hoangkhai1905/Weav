package com.weav.workflow.infrastructure.sheets;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GoogleSheetsContractTest {

    private static final String TOKEN = "synthetic-sheets-token";

    @Test
    void readUsesTheDocumentedGetPathAndEncodesEachPathParameter() {
        RecordingTransport transport = new RecordingTransport(response(200, Map.of("values", List.of())));
        GoogleSheetsClient client = new GoogleSheetsClient(transport);
        ResolvedConnection connection = connection();

        Map<String, Object> result = client.read("sheet/id ?", "Sheet One!A1:B2", connection);
        connection.close();

        assertEquals(Map.of("values", List.of()), result);
        assertEquals("GET", transport.method);
        assertEquals("https://sheets.googleapis.com/v4/spreadsheets/sheet%2Fid%20%3F/values/Sheet%20One%21A1%3AB2",
                transport.uri.toString());
        assertNull(transport.query);
        assertNull(transport.body);
        assertEquals(TOKEN, transport.accessToken);
        assertThrows(IllegalStateException.class, connection::auth);
    }

    @Test
    void appendUsesRawInputOptionRowsAndPreservesJsonCellTypes() {
        RecordingTransport transport = new RecordingTransport(response(200, Map.of("updates", Map.of("updatedRows", 1))));
        GoogleSheetsClient client = new GoogleSheetsClient(transport);
        ResolvedConnection connection = connection();
        List<Object> row = new ArrayList<>(Arrays.asList("=literal text", 9, false, null));
        List<List<Object>> values = List.of(row);

        Map<String, Object> result = client.append("sheet-id", "Sheet1!A1:D1", values, connection);
        connection.close();

        assertEquals(Map.of("updates", Map.of("updatedRows", 1)), result);
        assertEquals("POST", transport.method);
        assertEquals("https://sheets.googleapis.com/v4/spreadsheets/sheet-id/values/Sheet1%21A1%3AD1:append",
                transport.uri.toString());
        assertEquals(Map.of("valueInputOption", "RAW"), transport.query);
        Map<?, ?> body = assertInstanceOf(Map.class, transport.body);
        assertEquals("Sheet1!A1:D1", body.get("range"));
        assertEquals("ROWS", body.get("majorDimension"));
        assertEquals(values, body.get("values"));
        List<?> sentRow = (List<?>) ((List<?>) body.get("values")).getFirst();
        assertEquals("=literal text", sentRow.get(0));
        assertEquals(9, sentRow.get(1));
        assertEquals(false, sentRow.get(2));
        assertNull(sentRow.get(3));
        assertEquals(TOKEN, transport.accessToken);
    }

    @Test
    void updateUsesTheDocumentedPutPathAndRawQuery() {
        RecordingTransport transport = new RecordingTransport(response(200, Map.of("updatedRange", "Sheet1!A1")));
        GoogleSheetsClient client = new GoogleSheetsClient(transport);
        ResolvedConnection connection = connection();

        client.update("sheet-id", "Sheet1!A1", List.of(List.of("text")), connection);
        connection.close();

        assertEquals("PUT", transport.method);
        assertEquals("https://sheets.googleapis.com/v4/spreadsheets/sheet-id/values/Sheet1%21A1",
                transport.uri.toString());
        assertEquals(Map.of("valueInputOption", "RAW"), transport.query);
        assertEquals("text", ((List<?>) ((List<?>) ((Map<?, ?>) transport.body).get("values")).getFirst())
                .getFirst());
    }

    @Test
    void classifiesProviderStatusWithoutRetainingProviderErrorDetails() {
        for (StatusCase statusCase : List.of(
                new StatusCase(401, "AUTHENTICATION_REJECTED", false),
                new StatusCase(403, "HTTP_BUSINESS_REJECTED", false),
                new StatusCase(429, "HTTP_RATE_LIMITED", true),
                new StatusCase(503, "HTTP_DEPENDENCY_UNAVAILABLE", true),
                new StatusCase(302, "HTTP_REDIRECT_REJECTED", false),
                new StatusCase(400, "HTTP_BUSINESS_REJECTED", false))) {
            RecordingTransport transport = new RecordingTransport(response(statusCase.status(),
                    Map.of("error", "provider-secret-detail")));
            GoogleSheetsClient client = new GoogleSheetsClient(transport);
            ResolvedConnection connection = connection();

            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> client.read("sheet-id", "Sheet1!A1", connection));
            connection.close();

            assertEquals(statusCase.code(), failure.code());
            assertEquals(statusCase.retryable(), failure.retryable());
            assertFalse(failure.getMessage().contains("provider-secret-detail"));
            assertTrue(transport.called);
            assertThrows(IllegalStateException.class, connection::auth);
        }
    }

    @Test
    void requiresTheExactWorkspaceGoogleSheetsOauthContractBeforeTransport() {
        RecordingTransport transport = new RecordingTransport(response(200, Map.of("values", List.of())));
        GoogleSheetsClient client = new GoogleSheetsClient(transport);
        for (ResolvedConnection connection : List.of(
                new ResolvedConnection("GMAIL", "OAUTH2", Map.of("accessToken", TOKEN)),
                new ResolvedConnection("GOOGLE_SHEETS", "TOKEN", Map.of("token", TOKEN)),
                new ResolvedConnection("GOOGLE_SHEETS", "OAUTH2",
                        Map.of("accessToken", TOKEN, "refreshToken", "synthetic-refresh-token")))) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> client.read("sheet-id", "Sheet1!A1", connection));
            connection.close();
            assertEquals("CONNECTION_CONFIGURATION_INVALID", failure.code());
            assertFalse(failure.retryable());
            assertFalse(transport.called);
            assertThrows(IllegalStateException.class, connection::auth);
        }
    }

    @Test
    void rejectsEmptyOrControlBearingPathParametersBeforeTransport() {
        RecordingTransport transport = new RecordingTransport(response(200, Map.of("values", List.of())));
        GoogleSheetsClient client = new GoogleSheetsClient(transport);
        for (String[] fields : List.of(
                new String[]{"", "Sheet1!A1"},
                new String[]{"sheet-id", "Sheet1!A1\n"})) {
            ResolvedConnection connection = connection();
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> client.read(fields[0], fields[1], connection));
            connection.close();
            assertEquals("CONFIGURATION_ERROR", failure.code());
            assertFalse(failure.retryable());
            assertFalse(transport.called);
            assertThrows(IllegalStateException.class, connection::auth);
        }
    }

    @Test
    void rejectsNonObjectSuccessPayloadRatherThanReturningUnstructuredProviderText() {
        RecordingTransport transport = new RecordingTransport(response(200, "not-json-object"));
        GoogleSheetsClient client = new GoogleSheetsClient(transport);
        ResolvedConnection connection = connection();

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> client.read("sheet-id", "Sheet1!A1", connection));
        connection.close();

        assertEquals("HTTP_INVALID_RESPONSE", failure.code());
        assertTrue(failure.retryable());
        assertFalse(failure.getMessage().contains("not-json-object"));
    }

    private static ResolvedConnection connection() {
        return new ResolvedConnection("GOOGLE_SHEETS", "OAUTH2", Map.of("accessToken", TOKEN));
    }

    private static PinnedHttpTransport.HttpResponse response(int status, Object data) {
        return new PinnedHttpTransport.HttpResponse(status, data, Map.of());
    }

    private record StatusCase(int status, String code, boolean retryable) {
    }

    private static final class RecordingTransport extends PinnedHttpTransport {
        private final HttpResponse response;
        private boolean called;
        private URI uri;
        private String method;
        private Object query;
        private Object body;
        private String accessToken;

        private RecordingTransport(HttpResponse response) {
            super();
            this.response = response;
        }

        @Override
        public HttpResponse executeGoogleSheetsWithBearerToken(
                URI target, String method, Object query, Object body, String accessToken) {
            this.called = true;
            this.uri = target;
            this.method = method;
            this.query = query;
            this.body = body;
            this.accessToken = accessToken;
            return response;
        }
    }
}
