package com.weav.workflow.infrastructure.google;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Calendar and Drive executors against a fake Google transport (no network). */
class GoogleApiNodeExecutorsTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("c77f6cef-78ca-4840-910d-ed8ce8c519b2");
    private static final UUID CONNECTION_ID = UUID.fromString("988998bb-f44c-44a6-86c7-1dc568b9623f");
    private static final String TOKEN = "synthetic-google-access-token";
    private static final String BASE = "https://www.googleapis.com";

    // ---- Calendar ----

    @Test
    void calendarCreatesAnEventOnThePrimaryCalendar() {
        Fixture f = new Fixture("GOOGLE_CALENDAR", 200, Map.of(
                "id", "evt1", "htmlLink", "https://calendar.google.com/e", "status", "confirmed",
                "start", Map.of("dateTime", "2026-10-05T09:00:00+07:00"),
                "end", Map.of("dateTime", "2026-10-05T10:00:00+07:00"),
                "Authorization", "Bearer " + TOKEN));

        NodeExecutor.Result result = f.calendar().execute(f.context(), calendar(Map.of()));

        assertEquals(BASE + "/calendar/v3/calendars/primary/events", f.transport.uri.toString());
        assertEquals("POST", f.transport.method);
        assertEquals(Map.of("sendUpdates", "none"), f.transport.query);
        assertEquals(TOKEN, f.transport.accessToken);
        Map<?, ?> body = assertInstanceOf(Map.class, f.transport.body);
        assertEquals("Standup", body.get("summary"));
        assertEquals(Map.of("dateTime", "2026-10-05T09:00:00+07:00"), body.get("start"));
        assertEquals(Map.of("dateTime", "2026-10-05T10:00:00+07:00"), body.get("end"));
        assertFalse(body.containsKey("attendees"));
        assertEquals("evt1", result.output().get("eventId"));
        assertEquals("https://calendar.google.com/e", result.output().get("htmlLink"));
        assertEquals("confirmed", result.output().get("status"));
        assertEquals(Map.of("dateTime", "2026-10-05T10:00:00+07:00"), result.output().get("end"));
        assertFalse(result.output().toString().contains(TOKEN));
        assertThrows(IllegalStateException.class, f.resolved::auth);
    }

    @Test
    void calendarEncodesTheCalendarIdAsOnePathSegment() {
        Fixture f = new Fixture("GOOGLE_CALENDAR", 200, Map.of("id", "e"));

        f.calendar().execute(f.context(), calendar(Map.of("calendarId", "team a/b?x@group.calendar.google.com")));

        assertEquals(BASE + "/calendar/v3/calendars/team%20a%2Fb%3Fx%40group.calendar.google.com/events",
                f.transport.uri.toString());
    }

    @Test
    void calendarAddsAttendeesWithoutEmailsUnlessInvitationsAreEnabled() {
        for (Object flag : new Object[]{null, false, "false", ""}) {
            Fixture f = new Fixture("GOOGLE_CALENDAR", 200, Map.of("id", "e"));
            Map<String, Object> config = calendar(Map.of("attendees", List.of("a@example.test")));
            config.put("sendInvitations", flag);
            f.calendar().execute(f.context(), config);
            assertEquals(Map.of("sendUpdates", "none"), f.transport.query, String.valueOf(flag));
            assertEquals(List.of(Map.of("email", "a@example.test")), ((Map<?, ?>) f.transport.body).get("attendees"));
        }
        for (Object flag : new Object[]{true, "true"}) {
            Fixture f = new Fixture("GOOGLE_CALENDAR", 200, Map.of("id", "e"));
            f.calendar().execute(f.context(), calendar(Map.of(
                    "attendees", List.of("a@example.test"), "sendInvitations", flag)));
            assertEquals(Map.of("sendUpdates", "all"), f.transport.query, String.valueOf(flag));
        }
        // No attendees: nothing to invite even when enabled.
        Fixture f = new Fixture("GOOGLE_CALENDAR", 200, Map.of("id", "e"));
        f.calendar().execute(f.context(), calendar(Map.of("sendInvitations", true)));
        assertEquals(Map.of("sendUpdates", "none"), f.transport.query);
    }

    @Test
    void calendarSendsLocalTimesInTheGivenZoneWithAttendeesAndDetails() {
        Fixture f = new Fixture("GOOGLE_CALENDAR", 200, Map.of("id", "e"));

        f.calendar().execute(f.context(), calendar(Map.of(
                "start", "2026-10-05T09:00:00", "end", "2026-10-05T10:30:00",
                "timeZone", "Asia/Ho_Chi_Minh", "location", "Room 1", "description", "line1\nline2",
                "attendees", List.of("a@example.test", "b@example.test"))));

        assertEquals(Map.of("sendUpdates", "none"), f.transport.query);
        Map<?, ?> body = (Map<?, ?>) f.transport.body;
        assertEquals(List.of(Map.of("email", "a@example.test"), Map.of("email", "b@example.test")),
                body.get("attendees"));
        assertEquals(Map.of("dateTime", "2026-10-05T09:00:00", "timeZone", "Asia/Ho_Chi_Minh"), body.get("start"));
        assertEquals("Room 1", body.get("location"));
        assertEquals("line1\nline2", body.get("description"));
    }

    @Test
    void calendarSupportsAllDayEvents() {
        Fixture f = new Fixture("GOOGLE_CALENDAR", 200, Map.of("id", "e"));

        f.calendar().execute(f.context(), calendar(Map.of("start", "2026-10-05", "end", "2026-10-06")));

        Map<?, ?> body = (Map<?, ?>) f.transport.body;
        assertEquals(Map.of("date", "2026-10-05"), body.get("start"));
        assertEquals(Map.of("date", "2026-10-06"), body.get("end"));
    }

    @Test
    void calendarRejectsInvalidScheduleBeforeAnyRequest() {
        List<Map<String, Object>> invalid = List.of(
                Map.of("end", "2026-10-05T09:00:00+07:00"),
                Map.of("end", "2026-10-05T08:00:00+07:00"),
                Map.of("start", "2026-10-05", "end", "2026-10-05"),
                Map.of("start", "2026-10-05", "end", "2026-10-06T00:00:00Z"),
                Map.of("start", "not a date"),
                Map.of("start", "2026-10-05T09:00:00", "end", "2026-10-05T10:00:00"),
                Map.of("timeZone", "Mars/Olympus"),
                Map.of("attendees", List.of("not-an-email")),
                Map.of("attendees", "a@example.test"),
                Map.of("sendInvitations", "maybe"),
                Map.of("summary", " "),
                Map.of("connectionId", "nope"));
        for (Map<String, Object> override : invalid) {
            Fixture f = new Fixture("GOOGLE_CALENDAR", 200, Map.of("id", "e"));
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> f.calendar().execute(f.context(), calendar(override)), override.toString());
            assertEquals("CONFIGURATION_ERROR", failure.code(), override.toString());
            assertFalse(failure.retryable());
            assertFalse(f.transport.called, override.toString());
            assertEquals(0, f.workspace.resolveCalls);
        }
    }

    @Test
    void calendarRejectsResponseWithoutAnEventId() {
        Fixture f = new Fixture("GOOGLE_CALENDAR", 200, Map.of("status", "confirmed"));
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> f.calendar().execute(f.context(), calendar(Map.of())));
        assertEquals("HTTP_INVALID_RESPONSE", failure.code());
    }

    // ---- Drive ----

    @Test
    void driveUploadsATextFileAsMultipart() {
        Fixture f = new Fixture("GOOGLE_DRIVE", 200, Map.of(
                "id", "file1", "name", "note.txt", "mimeType", "text/plain", "webViewLink", "https://drive/f"));

        NodeExecutor.Result result = f.drive().execute(f.context(), drive(Map.of(
                "operation", "upload", "name", "note \"1\".txt", "content", "héllo", "folderId", "folder-1")));

        assertEquals(BASE + "/upload/drive/v3/files", f.transport.uri.toString());
        assertEquals("POST", f.transport.method);
        assertEquals(Map.of("uploadType", "multipart", "fields", "id,name,mimeType,webViewLink"),
                f.transport.query);
        PinnedHttpTransport.RawBody body = assertInstanceOf(PinnedHttpTransport.RawBody.class, f.transport.body);
        assertTrue(body.contentType().startsWith("multipart/related; boundary=weav-"));
        String text = new String(body.bytes(), StandardCharsets.UTF_8);
        String boundary = body.contentType().substring("multipart/related; boundary=".length());
        assertTrue(text.startsWith("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"));
        assertTrue(text.contains("{\"name\":\"note \\\"1\\\".txt\",\"mimeType\":\"text/plain\","
                + "\"parents\":[\"folder-1\"]}"));
        assertTrue(text.contains("\r\nContent-Type: text/plain\r\n\r\nhéllo\r\n--" + boundary + "--"));
        assertEquals("file1", result.output().get("id"));
        assertEquals("https://drive/f", result.output().get("webViewLink"));
        assertThrows(IllegalStateException.class, f.resolved::auth);
    }

    @Test
    void driveRejectsOversizedUploadAndMissingNameBeforeAnyRequest() {
        String tooBig = "x".repeat(GoogleDriveNodeExecutor.MAX_CONTENT_BYTES + 1);
        String multibyteTooBig = "é".repeat(GoogleDriveNodeExecutor.MAX_CONTENT_BYTES / 2 + 1);
        List<Map<String, Object>> invalid = List.of(
                Map.of("operation", "upload", "name", "a.txt", "content", tooBig),
                Map.of("operation", "upload", "name", "a.txt", "content", multibyteTooBig),
                Map.of("operation", "upload", "content", "x"),
                Map.of("operation", "upload", "name", "a.txt", "content", 5),
                Map.of("operation", "upload", "name", "a.txt", "mimeType", "bad type"),
                Map.of("operation", "delete"),
                Map.of("operation", "list", "pageSize", 0),
                Map.of("operation", "list", "pageSize", "abc"),
                Map.of("operation", "list", "pageSize", 1.5));
        for (Map<String, Object> override : invalid) {
            Fixture f = new Fixture("GOOGLE_DRIVE", 200, Map.of("id", "x"));
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> f.drive().execute(f.context(), drive(override)));
            assertEquals("CONFIGURATION_ERROR", failure.code());
            assertFalse(failure.retryable());
            assertFalse(f.transport.called);
        }
    }

    @Test
    void driveUploadAtTheLimitIsAccepted() {
        Fixture f = new Fixture("GOOGLE_DRIVE", 200, Map.of("id", "x"));
        f.drive().execute(f.context(), drive(Map.of("operation", "upload", "name", "a.txt",
                "content", "x".repeat(GoogleDriveNodeExecutor.MAX_CONTENT_BYTES))));
        assertTrue(f.transport.called);
    }

    @Test
    void driveListBuildsAnEscapedQueryAndClampsThePageSize() {
        Fixture f = new Fixture("GOOGLE_DRIVE", 200, Map.of("files", List.of(
                Map.of("id", "1", "name", "a"), "junk", Map.of("id", "2", "name", "b")),
                "nextPageToken", "ignored"));

        NodeExecutor.Result result = f.drive().execute(f.context(), drive(Map.of(
                "operation", "list", "folderId", "f'1\\", "nameContains", "O'Brien\\x", "pageSize", 500)));

        assertEquals(BASE + "/drive/v3/files", f.transport.uri.toString());
        assertEquals("GET", f.transport.method);
        assertNull(f.transport.body);
        Map<?, ?> query = (Map<?, ?>) f.transport.query;
        assertEquals("trashed = false and 'f\\'1\\\\' in parents and name contains 'O\\'Brien\\\\x'", query.get("q"));
        assertEquals("100", query.get("pageSize"));
        assertEquals("files(id,name,mimeType,modifiedTime,webViewLink)", query.get("fields"));
        assertEquals(List.of(Map.of("id", "1", "name", "a"), Map.of("id", "2", "name", "b")),
                result.output().get("files"));
        assertFalse(result.output().containsKey("nextPageToken"));
    }

    @Test
    void driveListDefaultsToAllLiveFiles() {
        Fixture f = new Fixture("GOOGLE_DRIVE", 200, Map.of());

        NodeExecutor.Result result = f.drive().execute(f.context(), drive(Map.of("operation", "list", "pageSize", "7")));

        Map<?, ?> query = (Map<?, ?>) f.transport.query;
        assertEquals("trashed = false", query.get("q"));
        assertEquals("7", query.get("pageSize"));
        assertEquals(List.of(), result.output().get("files"));
    }

    // ---- Provider errors ----

    @Test
    void mapsProviderStatusForBothNodesWithoutLeakingDetails() {
        Map<String, Object> rateLimit = Map.of("error", Map.of("errors", List.of(Map.of("reason", "rateLimitExceeded"))));
        Map<String, Object> noScope = Map.of("error", Map.of("errors", List.of(Map.of("reason", "insufficientPermissions")),
                "message", "provider-secret-detail"));
        List<Case> cases = List.of(
                new Case(401, Map.of("error", "provider-secret-detail"), "AUTHENTICATION_REJECTED", false),
                new Case(403, noScope, "HTTP_BUSINESS_REJECTED", false),
                new Case(403, rateLimit, "HTTP_RATE_LIMITED", true),
                new Case(404, Map.of("error", "provider-secret-detail"), "HTTP_BUSINESS_REJECTED", false),
                new Case(429, Map.of("error", "provider-secret-detail"), "HTTP_RATE_LIMITED", true),
                new Case(500, Map.of("error", "provider-secret-detail"), "HTTP_DEPENDENCY_UNAVAILABLE", true),
                new Case(503, "provider-secret-detail", "HTTP_DEPENDENCY_UNAVAILABLE", true));
        for (Case c : cases) {
            for (boolean calendar : List.of(true, false)) {
                Fixture f = new Fixture(calendar ? "GOOGLE_CALENDAR" : "GOOGLE_DRIVE", c.status(), c.data());
                NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class, () -> {
                    if (calendar) {
                        f.calendar().execute(f.context(), calendar(Map.of()));
                    } else {
                        f.drive().execute(f.context(), drive(Map.of("operation", "list")));
                    }
                });
                assertEquals(c.code(), failure.code(), c.status() + " " + calendar);
                assertEquals(c.retryable(), failure.retryable(), c.status() + " " + calendar);
                assertFalse(failure.getMessage().contains("provider-secret-detail"));
                assertFalse(failure.getMessage().contains(TOKEN));
                assertEquals(c.status() == 401 ? 1 : 0, f.workspace.reportCalls);
                assertThrows(IllegalStateException.class, f.resolved::auth);
            }
        }
    }

    @Test
    void forbiddenMessageTellsTheUserToReconnect() {
        Fixture f = new Fixture("GOOGLE_DRIVE", 403, Map.of());
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> f.drive().execute(f.context(), drive(Map.of("operation", "list"))));
        assertTrue(failure.getMessage().contains("reconnect"), failure.getMessage());
    }

    @Test
    void notFoundMessageMentionsTheDriveFileVisibilityLimit() {
        Fixture f = new Fixture("GOOGLE_DRIVE", 404, Map.of());
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> f.drive().execute(f.context(), drive(Map.of("operation", "list", "folderId", "x"))));
        assertEquals("HTTP_BUSINESS_REJECTED", failure.code());
        assertTrue(failure.getMessage().contains("created or opened by Weav"), failure.getMessage());
    }

    @Test
    void rejectsAConnectionOfAnotherProvider() {
        Fixture f = new Fixture("GOOGLE_SHEETS", 200, Map.of("id", "e"));
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> f.calendar().execute(f.context(), calendar(Map.of())));
        assertEquals("CONNECTION_CONFIGURATION_INVALID", failure.code());
        assertFalse(f.transport.called);
    }

    @Test
    void transportOnlyReachesTheFixedGoogleEndpointsWithTheirMethod() {
        PinnedHttpTransport transport = new PinnedHttpTransport();
        String host = "https://www.googleapis.com";
        List<String[]> rejected = List.of(
                new String[]{"POST", "https://evil.example/calendar/v3/calendars/x/events"},
                new String[]{"POST", "http://www.googleapis.com/calendar/v3/calendars/x/events"},
                new String[]{"POST", host + "/gmail/v1/users/me/messages/send"},
                new String[]{"GET", "https://www.googleapis.com:8443/drive/v3/files"},
                new String[]{"GET", "https://user@www.googleapis.com/drive/v3/files"},
                new String[]{"DELETE", host + "/drive/v3/files"},
                new String[]{"POST", host + "/drive/v3/files"},
                new String[]{"GET", host + "/upload/drive/v3/files"},
                new String[]{"GET", host + "/drive/v3/files/abc"},
                new String[]{"POST", host + "/upload/drive/v3/files/abc"},
                new String[]{"POST", host + "/calendar/v3/calendars/x/events/extra"},
                new String[]{"POST", host + "/calendar/v3/calendars/x/y/events"},
                new String[]{"POST", host + "/calendar/v3/calendars//events"},
                new String[]{"POST", host + "/calendar/v3/calendars/../events"},
                new String[]{"POST", host + "/calendar/v3/calendars/%2e%2e/events"},
                new String[]{"POST", host + "/calendar/v3/calendars/%2E/events"},
                new String[]{"POST", host + "/calendar/v3/calendars/a%5Cb/events"},
                new String[]{"GET", host + "/drive/v3/%2Ffiles"},
                new String[]{"GET", host + "/drive/v3/files%2F"},
                new String[]{"POST", host + "/calendar/v3%2Fcalendars/x/events"},
                new String[]{"POST", host + "/calendar/v3/calendars/a%2F..%2Fb/events"});
        for (String[] request : rejected) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> transport.executeGoogleApiWithBearerToken(
                            URI.create(request[1]), request[0], null, null, TOKEN), request[0] + " " + request[1]);
            assertEquals("HTTP_REQUEST_INVALID", failure.code(), request[1]);
        }
    }

    @Test
    void transportAllowsAnEncodedSlashOnlyInsideTheCalendarId() {
        // Passes validation; the call then fails at the stubbed DNS lookup (no network), never with HTTP_REQUEST_INVALID.
        PinnedHttpTransport transport = new PinnedHttpTransport(
                new com.weav.workflow.infrastructure.http.OutboundHttpProperties(),
                new tools.jackson.databind.ObjectMapper(),
                new com.weav.workflow.infrastructure.http.OutboundTargetPolicy(host -> {
                    throw new java.net.UnknownHostException(host);
                }));
        try {
            transport.executeGoogleApiWithBearerToken(URI.create(
                    "https://www.googleapis.com/calendar/v3/calendars/a%2Fb%40x/events"), "POST", null, null, TOKEN);
        } catch (NodeExecutor.Failure failure) {
            assertFalse("HTTP_REQUEST_INVALID".equals(failure.code()), failure.code());
        }
    }

    // ---- helpers ----

    private static Map<String, Object> calendar(Map<String, Object> overrides) {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("connectionId", CONNECTION_ID.toString());
        config.put("summary", "Standup");
        config.put("start", "2026-10-05T09:00:00+07:00");
        config.put("end", "2026-10-05T10:00:00+07:00");
        config.putAll(overrides);
        return config;
    }

    private static Map<String, Object> drive(Map<String, Object> overrides) {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("connectionId", CONNECTION_ID.toString());
        config.putAll(overrides);
        return config;
    }

    private record Case(int status, Object data, String code, boolean retryable) {
    }

    private static final class Fixture {
        private final RecordingTransport transport;
        private final FakeWorkspace workspace;
        private final ResolvedConnection resolved;

        private Fixture(String provider, int status, Object data) {
            this.transport = new RecordingTransport(new PinnedHttpTransport.HttpResponse(status, data, Map.of()));
            this.resolved = new ResolvedConnection(provider, "OAUTH2", Map.of("accessToken", TOKEN));
            this.workspace = new FakeWorkspace(resolved);
        }

        private GoogleCalendarNodeExecutor calendar() {
            return new GoogleCalendarNodeExecutor(new GoogleApiClient(transport), workspace);
        }

        private GoogleDriveNodeExecutor drive() {
            return new GoogleDriveNodeExecutor(new GoogleApiClient(transport), workspace,
                    org.mockito.Mockito.mock(com.weav.workflow.application.port.out.WorkflowFileStore.class));
        }

        private NodeExecutor.Context context() {
            return new NodeExecutor.Context(WORKSPACE_ID, UUID.randomUUID(), UUID.randomUUID(),
                    "google-node", 1, "correlation-id", null);
        }
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
        public HttpResponse executeGoogleApiWithBearerToken(
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

    private static final class FakeWorkspace implements WorkspaceConnectionPort {
        private final ResolvedConnection resolved;
        private int resolveCalls;
        private int reportCalls;
        private final List<UUID> resolvedIds = new ArrayList<>();

        private FakeWorkspace(ResolvedConnection resolved) {
            this.resolved = resolved;
        }

        @Override
        public void authorizeAttachment(UUID workspaceId, UUID connectionId, UUID userId) {
        }

        @Override
        public ResolvedConnection resolve(UUID workspaceId, UUID connectionId) {
            resolveCalls++;
            resolvedIds.add(connectionId);
            return resolved;
        }

        @Override
        public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
            reportCalls++;
        }
    }
}
