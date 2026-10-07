package com.weav.workflow.infrastructure.google;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Calendar list against a recording client-level transport (no network, no real URI allow-list). */
class GoogleCalendarListTest {

    private static final UUID CONNECTION_ID = UUID.fromString("988998bb-f44c-44a6-86c7-1dc568b9623f");
    private static final String TOKEN = "synthetic-google-access-token";

    private static Map<String, Object> event(String id, String summary) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("id", id);
        event.put("summary", summary);
        event.put("description", "private notes");
        event.put("location", "Room 1");
        event.put("htmlLink", "https://calendar.example.test/" + id);
        event.put("status", "confirmed");
        event.put("attendees", List.of(Map.of("email", "someone@example.test")));
        event.put("start", Map.of("dateTime", "2026-10-07T09:00:00+07:00", "timeZone", "Asia/Ho_Chi_Minh"));
        event.put("end", Map.of("dateTime", "2026-10-07T10:00:00+07:00"));
        return event;
    }

    private static Map<String, Object> config() {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("connectionId", CONNECTION_ID.toString());
        config.put("operation", "list");
        return config;
    }

    @Test
    void listReadsUpcomingEventsAndProjectsOnlySafeFields() {
        Recorder transport = new Recorder(200, Map.of("items", List.of(event("e1", "Standup"), event("e2", "Review"))));
        Instant before = Instant.now();

        Map<String, Object> output = run(transport, config());

        assertEquals("GET", transport.method);
        assertEquals("https://www.googleapis.com/calendar/v3/calendars/primary/events", transport.uri.toString());
        assertNull(transport.body);
        assertEquals(TOKEN, transport.accessToken);
        Map<?, ?> query = (Map<?, ?>) transport.query;
        assertEquals("true", query.get("singleEvents"));
        assertEquals("startTime", query.get("orderBy"));
        assertEquals("11", query.get("maxResults"), "default 10 plus one to detect truncation");
        assertFalse(query.containsKey("timeMax") || query.containsKey("q"));
        Instant timeMin = Instant.parse((String) query.get("timeMin"));
        assertTrue(!timeMin.isBefore(before.minusSeconds(1)) && !timeMin.isAfter(Instant.now().plusSeconds(1)));

        assertEquals(2, output.get("count"));
        assertEquals(false, output.get("truncated"));
        Map<?, ?> first = (Map<?, ?>) ((List<?>) output.get("events")).getFirst();
        assertEquals(List.of("id", "summary", "start", "end", "location", "htmlLink", "status"),
                new ArrayList<>(first.keySet()));
        assertEquals("Standup", first.get("summary"));
        assertEquals(Map.of("dateTime", "2026-10-07T09:00:00+07:00", "timeZone", "Asia/Ho_Chi_Minh"),
                first.get("start"));
        assertFalse(output.toString().contains("someone@example.test") || output.toString().contains("private notes"));
    }

    @Test
    void listPassesWindowQueryAndCalendarAndEncodesTheCalendarId() {
        Recorder transport = new Recorder(200, Map.of("items", List.of()));
        Map<String, Object> config = config();
        config.put("calendarId", "team@group.calendar.google.com/x");
        config.put("timeMin", "2026-10-07T00:00:00+07:00");
        config.put("timeMax", "2026-10-08");
        config.put("maxResults", "5");
        config.put("query", "standup");

        Map<String, Object> output = run(transport, config);

        assertEquals("https://www.googleapis.com/calendar/v3/calendars/team%40group.calendar.google.com%2Fx/events",
                transport.uri.toString());
        Map<?, ?> query = (Map<?, ?>) transport.query;
        assertEquals("2026-10-06T17:00:00Z", query.get("timeMin"));
        assertEquals("2026-10-08T00:00:00Z", query.get("timeMax"));
        assertEquals("6", query.get("maxResults"));
        assertEquals("standup", query.get("q"));
        assertEquals(0, output.get("count"));
        assertEquals(List.of(), output.get("events"));
    }

    @Test
    void listTrimsToMaxResultsAndFlagsTruncation() {
        List<Object> items = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            items.add(event("e" + i, "E" + i));
        }
        Map<String, Object> config = config();
        config.put("maxResults", 3);

        Map<String, Object> output = run(new Recorder(200, Map.of("items", items)), config);

        assertEquals(3, output.get("count"));
        assertEquals(true, output.get("truncated"));
        Map<String, Object> exact = run(new Recorder(200, Map.of("items", items.subList(0, 3))), config);
        assertEquals(false, exact.get("truncated"));
    }

    @Test
    void listBoundsAndBadInputFailBeforeAnyCall() {
        for (Map<String, Object> broken : List.of(
                with("maxResults", 51), with("maxResults", 0), with("maxResults", 1.5d), with("maxResults", "many"),
                with("timeMin", "not a date"), with("timeMin", "2026-10-07T09:00:00"),
                with("timeMax", "2020-01-01"), with("operation", "delete"), with("operation", 5))) {
            Recorder transport = new Recorder(200, Map.of());
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> run(transport, broken), broken.toString());
            assertEquals("CONFIGURATION_ERROR", failure.code());
            assertFalse(failure.retryable());
            assertFalse(transport.called);
        }
        Map<String, Object> max = config();
        max.put("maxResults", 50);
        assertEquals("51", ((Map<?, ?>) callQuery(max)).get("maxResults"));
    }

    @Test
    void createWithoutAnOperationBehavesExactlyAsBefore() {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("connectionId", CONNECTION_ID.toString());
        config.put("summary", "Planning");
        config.put("start", "2026-10-05T09:00:00+07:00");
        config.put("end", "2026-10-05T10:00:00+07:00");
        for (Object operation : new Object[] {null, "create", ""}) {
            Recorder transport = new Recorder(200, Map.of("id", "ev1", "status", "confirmed"));
            Map<String, Object> withOperation = new LinkedHashMap<>(config);
            if (operation != null) {
                withOperation.put("operation", operation);
            }

            Map<String, Object> output = run(transport, withOperation);

            assertEquals("POST", transport.method);
            assertEquals(Map.of("sendUpdates", "none"), transport.query);
            assertEquals("ev1", output.get("eventId"));
            assertEquals("Planning", ((Map<?, ?>) transport.body).get("summary"));
        }
    }

    private static Map<String, Object> with(String key, Object value) {
        Map<String, Object> config = config();
        config.put(key, value);
        return config;
    }

    private static Object callQuery(Map<String, Object> config) {
        Recorder transport = new Recorder(200, Map.of("items", List.of()));
        run(transport, config);
        return transport.query;
    }

    private static Map<String, Object> run(Recorder transport, Map<String, Object> config) {
        ResolvedConnection resolved = new ResolvedConnection("GOOGLE_CALENDAR", "OAUTH2", Map.of("accessToken", TOKEN));
        GoogleCalendarNodeExecutor executor = new GoogleCalendarNodeExecutor(new GoogleApiClient(transport),
                new WorkspaceConnectionPort() {
                    @Override
                    public void authorizeAttachment(UUID workspaceId, UUID connectionId, UUID userId) {
                    }

                    @Override
                    public ResolvedConnection resolve(UUID workspaceId, UUID connectionId) {
                        return resolved;
                    }

                    @Override
                    public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
                    }
                });
        return executor.execute(new NodeExecutor.Context(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                "calendar-node", 1, "correlation-id", null), config).output();
    }

    private static final class Recorder extends PinnedHttpTransport {
        private final HttpResponse response;
        private boolean called;
        private URI uri;
        private String method;
        private Object query;
        private Object body;
        private String accessToken;

        private Recorder(int status, Object data) {
            super();
            this.response = new HttpResponse(status, data, Map.of());
        }

        @Override
        public HttpResponse executeGoogleApiWithBearerToken(
                URI target, String method, Object query, Object body, String accessToken) {
            called = true;
            uri = target;
            this.method = method;
            this.query = query;
            this.body = body;
            this.accessToken = accessToken;
            return response;
        }
    }
}
