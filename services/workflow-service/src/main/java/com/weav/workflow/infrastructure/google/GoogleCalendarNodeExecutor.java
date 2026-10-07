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

/** Creates one Google Calendar event, or lists upcoming ones, with Workspace-owned OAuth credentials. */
@Component
public final class GoogleCalendarNodeExecutor extends GoogleApiNodeExecutor {

    private static final String TYPE = "google.calendar";
    private static final String PROVIDER = "GOOGLE_CALENDAR";
    private static final String SERVICE = "Google Calendar";
    private static final String DEFAULT_CALENDAR = "primary";
    private static final int MAX_LINE_LENGTH = 1024;
    private static final int MAX_ATTENDEES = 100;
    private static final int MAX_EMAIL_LENGTH = 320;
    private static final int DEFAULT_MAX_RESULTS = 10;
    private static final int MAX_RESULTS_LIMIT = 50;

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
        // No operation (every config saved before "list" existed) means create.
        Object requested = config.get("operation");
        String operation = requested == null || requested instanceof String text && text.isBlank() ? "create"
                : requested instanceof String text ? text : null;
        return switch (operation == null ? "" : operation) {
            case "create" -> create(connectionId, path, config);
            case "list" -> list(connectionId, path, config);
            default -> throw configurationFailure();
        };
    }

    private Call list(java.util.UUID connectionId, String path, Map<String, Object> config) {
        Instant timeMin = optionalInstant(config.get("timeMin"));
        timeMin = timeMin == null ? Instant.now() : timeMin;
        Instant timeMax = optionalInstant(config.get("timeMax"));
        if (timeMax != null && !timeMax.isAfter(timeMin)) {
            throw configurationFailure();
        }
        int maxResults = maxResults(config.get("maxResults"));
        String text = optionalText(config.get("query"), MAX_LINE_LENGTH);

        Map<String, String> query = new LinkedHashMap<>();
        query.put("singleEvents", "true");
        query.put("orderBy", "startTime");
        query.put("timeMin", timeMin.toString());
        if (timeMax != null) {
            query.put("timeMax", timeMax.toString());
        }
        if (text != null) {
            query.put("q", text);
        }
        // One extra event tells "exactly maxResults" from "more exist".
        query.put("maxResults", Integer.toString(maxResults + 1));

        return new Call(connectionId, connection -> {
            Map<String, Object> response = client.call(connection, PROVIDER, SERVICE, "GET", path, query, null);
            List<Object> events = new ArrayList<>();
            boolean truncated = false;
            if (response.get("items") instanceof List<?> items) {
                for (Object item : items) {
                    if (!(item instanceof Map<?, ?> event)) {
                        continue;
                    }
                    if (events.size() == maxResults) {
                        truncated = true;
                        break;
                    }
                    events.add(projectEvent(event));
                }
            }
            Map<String, Object> output = new LinkedHashMap<>();
            output.put("events", events);
            output.put("count", events.size());
            output.put("truncated", truncated);
            return output;
        });
    }

    /** Only the fields a workflow needs: no attendee emails, no description. */
    private static Map<String, Object> projectEvent(Map<?, ?> event) {
        Map<String, Object> projected = new LinkedHashMap<>();
        for (String key : List.of("id", "summary")) {
            projected.put(key, event.get(key) instanceof String value ? value : null);
        }
        projected.put("start", projectTime(event.get("start")));
        projected.put("end", projectTime(event.get("end")));
        for (String key : List.of("location", "htmlLink", "status")) {
            projected.put(key, event.get(key) instanceof String value ? value : null);
        }
        return projected;
    }

    private static Map<String, Object> projectTime(Object time) {
        Map<String, Object> projected = new LinkedHashMap<>();
        if (time instanceof Map<?, ?> source) {
            for (String key : List.of("dateTime", "date", "timeZone")) {
                if (source.get(key) instanceof String value) {
                    projected.put(key, value);
                }
            }
        }
        return projected;
    }

    /** An RFC 3339 date-time with offset, or a date (midnight UTC); absent or blank means not set. */
    private Instant optionalInstant(Object value) {
        String text = optionalText(value, 64);
        if (text == null) {
            return null;
        }
        try {
            return text.length() == 10
                    ? LocalDate.parse(text.trim()).atStartOfDay(ZoneId.of("UTC")).toInstant()
                    : OffsetDateTime.parse(text.trim()).toInstant();
        } catch (DateTimeException exception) {
            throw configurationFailure();
        }
    }

    private int maxResults(Object value) {
        if (value == null || value instanceof String text && text.isBlank()) {
            return DEFAULT_MAX_RESULTS;
        }
        java.math.BigDecimal number;
        try {
            number = value instanceof Number n ? new java.math.BigDecimal(n.toString())
                    : value instanceof String text ? new java.math.BigDecimal(text.trim()) : null;
        } catch (NumberFormatException exception) {
            throw configurationFailure();
        }
        if (number == null || number.stripTrailingZeros().scale() > 0
                || number.signum() <= 0 || number.compareTo(java.math.BigDecimal.valueOf(MAX_RESULTS_LIMIT)) > 0) {
            throw configurationFailure();
        }
        return number.intValueExact();
    }

    private Call create(java.util.UUID connectionId, String path, Map<String, Object> config) {
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
