package com.weav.workflow.infrastructure.google;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import org.springframework.stereotype.Component;

import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Creates one Google Calendar event with Workspace-owned OAuth credentials. */
@Component
public final class GoogleCalendarNodeExecutor extends GoogleApiNodeExecutor {

    private static final String TYPE = "google.calendar";
    private static final String PROVIDER = "GOOGLE_CALENDAR";
    private static final String SERVICE = "Google Calendar";
    private static final String DEFAULT_CALENDAR = "primary";
    private static final int MAX_LINE_LENGTH = 1024;
    private static final int MAX_ATTENDEES = 100;
    private static final int MAX_EMAIL_LENGTH = 320;

    private final GoogleApiClient client;

    public GoogleCalendarNodeExecutor(GoogleApiClient client, WorkspaceConnectionPort workspaceConnections) {
        super(workspaceConnections, SERVICE);
        this.client = Objects.requireNonNull(client, "client must not be null");
    }

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    Call prepare(Map<String, Object> config) {
        var connectionId = parseConnectionId(config.get("connectionId"));
        String calendarId = optionalText(config.get("calendarId"), MAX_LINE_LENGTH);
        String path = "/calendar/v3/calendars/"
                + GoogleApiClient.encodePathSegment(calendarId == null ? DEFAULT_CALENDAR : calendarId, SERVICE)
                + "/events";
        String timeZone = optionalText(config.get("timeZone"), 64);
        if (timeZone != null && !ZoneId.getAvailableZoneIds().contains(timeZone)) {
            throw configurationFailure();
        }

        When start = parseWhen(config.get("start"), timeZone);
        When end = parseWhen(config.get("end"), timeZone);
        if (start.allDay() != end.allDay() || !start.sortKey().isBefore(end.sortKey())) {
            throw configurationFailure();
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("summary", requiredText(config.get("summary"), MAX_LINE_LENGTH));
        putIfPresent(body, "description", optionalMultilineText(config.get("description")));
        putIfPresent(body, "location", optionalText(config.get("location"), MAX_LINE_LENGTH));
        body.put("start", start.toEventTime(timeZone));
        body.put("end", end.toEventTime(timeZone));
        List<Map<String, String>> attendees = parseAttendees(config.get("attendees"));
        if (!attendees.isEmpty()) {
            body.put("attendees", attendees);
        }
        // Invitation emails go out only when the user opted in; Google's default would be "none" too, but be explicit.
        boolean invite = parseFlag(config.get("sendInvitations"));
        Map<String, String> query = Map.of("sendUpdates", invite && !attendees.isEmpty() ? "all" : "none");

        return new Call(connectionId, connection -> {
            Map<String, Object> event = client.call(
                    connection, PROVIDER, SERVICE, "POST", path, query, body);
            Object id = event.get("id");
            if (!(id instanceof String eventId) || eventId.isBlank()) {
                throw new NodeExecutor.Failure("HTTP_INVALID_RESPONSE",
                        "The " + SERVICE + " provider returned an invalid response.", true);
            }
            Map<String, Object> output = new LinkedHashMap<>();
            output.put("eventId", eventId);
            output.put("htmlLink", event.get("htmlLink"));
            output.put("status", event.get("status"));
            output.put("start", event.get("start"));
            output.put("end", event.get("end"));
            return output;
        });
    }

    private When parseWhen(Object value, String timeZone) {
        String text = requiredText(value, 64).trim();
        try {
            if (text.length() == 10) {
                LocalDate date = LocalDate.parse(text);
                return new When(true, text, date.atStartOfDay(ZoneId.of("UTC")).toInstant());
            }
            try {
                OffsetDateTime dateTime = OffsetDateTime.parse(text);
                return new When(false, text, dateTime.toInstant());
            } catch (DateTimeParseException notOffset) {
                if (timeZone == null) {
                    throw configurationFailure();
                }
                LocalDateTime local = LocalDateTime.parse(text);
                return new When(false, text, local.atZone(ZoneId.of(timeZone)).toInstant());
            }
        } catch (DateTimeException exception) {
            throw configurationFailure();
        }
    }

    private List<Map<String, String>> parseAttendees(Object value) {
        if (value == null) {
            return List.of();
        }
        if (!(value instanceof List<?> raw) || raw.size() > MAX_ATTENDEES) {
            throw configurationFailure();
        }
        List<Map<String, String>> attendees = new ArrayList<>(raw.size());
        for (Object item : raw) {
            String email = requiredText(item, MAX_EMAIL_LENGTH).trim();
            int at = email.indexOf('@');
            if (at < 1 || at != email.lastIndexOf('@') || at == email.length() - 1
                    || email.codePoints().anyMatch(c -> Character.isWhitespace(c) || c == ',' || c == ';'
                    || c == '<' || c == '>')) {
                throw configurationFailure();
            }
            attendees.add(Map.of("email", email));
        }
        return attendees;
    }

    private boolean parseFlag(Object value) {
        if (value == null || value instanceof String text && text.isBlank()) {
            return false;
        }
        if (value instanceof Boolean flag) {
            return flag;
        }
        if (value instanceof String text && (text.equals("true") || text.equals("false"))) {
            return Boolean.parseBoolean(text);
        }
        throw configurationFailure();
    }

    private static void putIfPresent(Map<String, Object> body, String key, String value) {
        if (value != null) {
            body.put(key, value);
        }
    }

    /** A parsed start or end: all-day date or date-time, plus an instant used only to order the two. */
    private record When(boolean allDay, String text, Instant sortKey) {
        Map<String, Object> toEventTime(String timeZone) {
            Map<String, Object> time = new LinkedHashMap<>();
            if (allDay) {
                time.put("date", text);
            } else {
                time.put("dateTime", text);
                if (timeZone != null) {
                    time.put("timeZone", timeZone);
                }
            }
            return time;
        }
    }
}
