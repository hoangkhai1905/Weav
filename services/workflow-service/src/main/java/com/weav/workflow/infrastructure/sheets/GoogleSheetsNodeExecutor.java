package com.weav.workflow.infrastructure.sheets;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ConnectionReconnectRequiredException;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.domain.definition.JsonValues;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.infrastructure.http.OutputSanitizer;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Executes V1 Google Sheets values operations using Workspace-owned OAuth credentials. */
@Component
public final class GoogleSheetsNodeExecutor implements NodeExecutor {

    private static final String TYPE = "google.sheets";
    private static final int MAX_TEXT_LENGTH = 8 * 1024;
    private static final int DEFAULT_LOOKUP_LIMIT = 10;
    private static final int MAX_LOOKUP_LIMIT = 100;
    /** First cell of an A1 range: optional column letters and optional row number. */
    private static final Pattern RANGE_START = Pattern.compile("\\$?([A-Za-z]{1,3})?\\$?(\\d+)?");

    private final GoogleSheetsClient sheetsClient;
    private final WorkspaceConnectionPort workspaceConnections;

    public GoogleSheetsNodeExecutor(
            GoogleSheetsClient sheetsClient, WorkspaceConnectionPort workspaceConnections) {
        this.sheetsClient = Objects.requireNonNull(sheetsClient, "sheetsClient must not be null");
        this.workspaceConnections = Objects.requireNonNull(
                workspaceConnections, "workspaceConnections must not be null");
    }

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    public Result execute(Context context, Map<String, Object> resolvedConfig) {
        Objects.requireNonNull(context, "context must not be null");
        Request request = parseConfig(resolvedConfig);
        ResolvedConnection connection = resolveConnection(context, request.connectionId());
        if (connection == null) {
            throw new NodeExecutor.Failure("CONNECTION_UNAVAILABLE",
                    "The Google Sheets connection is unavailable.", true, true);
        }

        try {
            Set<String> activeSecrets = activeSecrets(connection);
            Map<String, Object> providerOutput;
            try {
                providerOutput = switch (request.operation()) {
                    case "read" -> sheetsClient.read(request.spreadsheetId(), request.range(), connection);
                    case "lookup" -> lookup(request,
                            sheetsClient.read(request.spreadsheetId(), request.range(), connection));
                    case "append" -> request.valueInputOption() == null
                            ? sheetsClient.append(request.spreadsheetId(), request.range(), request.values(), connection)
                            : sheetsClient.append(request.spreadsheetId(), request.range(), request.values(),
                                    request.valueInputOption(), connection);
                    case "update" -> request.valueInputOption() == null
                            ? sheetsClient.update(request.spreadsheetId(), request.range(), request.values(), connection)
                            : sheetsClient.update(request.spreadsheetId(), request.range(), request.values(),
                                    request.valueInputOption(), connection);
                    default -> throw configurationFailure();
                };
            } catch (NodeExecutor.Failure failure) {
                if ("AUTHENTICATION_REJECTED".equals(failure.code())) {
                    reportAuthenticationRejected(context.workspaceId(), request.connectionId(), connection);
                }
                throw failure;
            } catch (RuntimeException exception) {
                throw new NodeExecutor.Failure("HTTP_DEPENDENCY_UNAVAILABLE",
                        "The Google Sheets provider is temporarily unavailable.", true);
            }

            Object sanitized = OutputSanitizer.sanitize(providerOutput, activeSecrets);
            if (!(sanitized instanceof Map<?, ?> output)) {
                throw new NodeExecutor.Failure("HTTP_INVALID_RESPONSE",
                        "The Google Sheets provider returned an invalid response.", true);
            }
            Map<String, Object> jsonOutput = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : output.entrySet()) {
                if (entry.getKey() instanceof String key) {
                    jsonOutput.put(key, entry.getValue());
                }
            }
            return new Result(jsonOutput, null);
        } finally {
            connection.close();
        }
    }

    private Request parseConfig(Map<String, Object> config) {
        if (config == null) {
            throw configurationFailure();
        }
        String operation = requiredText(config.get("operation"));
        if (!Set.of("read", "append", "update", "lookup").contains(operation)) {
            throw configurationFailure();
        }
        UUID connectionId = parseConnectionId(config.get("connectionId"));
        String spreadsheetId = requiredText(config.get("spreadsheetId"));
        String range = requiredText(config.get("range"));
        boolean write = "append".equals(operation) || "update".equals(operation);
        List<List<Object>> values = write ? parseValues(config.get("values")) : null;
        String valueInputOption = write ? valueInputOption(config.get("valueInputOption")) : null;
        int lookupColumn = -1;
        String lookupValue = null;
        int limit = DEFAULT_LOOKUP_LIMIT;
        if ("lookup".equals(operation)) {
            lookupColumn = columnIndex(config.get("lookupColumn"));
            lookupValue = lookupValue(config.get("lookupValue"));
            limit = limit(config.get("limit"));
        }
        return new Request(operation, spreadsheetId, range, values, connectionId, valueInputOption,
                lookupColumn, lookupValue, limit);
    }

    /** Absent or blank keeps today's RAW (the client default); anything but the two documented values fails. */
    private String valueInputOption(Object value) {
        if (value == null || value instanceof String text && text.isBlank()) {
            return null;
        }
        if (value instanceof String text && (text.equals("RAW") || text.equals("USER_ENTERED"))) {
            return text;
        }
        throw configurationFailure();
    }

    /** Column letters (A, b, AA) to a zero-based sheet column index. */
    private int columnIndex(Object value) {
        if (!(value instanceof String text) || !text.strip().matches("[A-Za-z]{1,3}")) {
            throw configurationFailure();
        }
        return columnNumber(text.strip());
    }

    private static int columnNumber(String letters) {
        int index = 0;
        for (char letter : letters.toUpperCase(java.util.Locale.ROOT).toCharArray()) {
            index = index * 26 + (letter - 'A' + 1);
        }
        return index - 1;
    }

    /** Exact text match; booleans ignore case because checkbox cells display as TRUE/FALSE. */
    private static boolean matches(String wanted, String cell) {
        return "true".equalsIgnoreCase(wanted) || "false".equalsIgnoreCase(wanted)
                ? wanted.equalsIgnoreCase(cell) : wanted.equals(cell);
    }

    private String lookupValue(Object value) {
        String text = value instanceof String || value instanceof Boolean || value instanceof Number
                ? JsonValues.scalarText(value) : null;
        if (text == null || text.isBlank() || text.length() > MAX_TEXT_LENGTH) {
            throw configurationFailure();
        }
        return text;
    }

    private int limit(Object value) {
        if (value == null || value instanceof String text && text.isBlank()) {
            return DEFAULT_LOOKUP_LIMIT;
        }
        java.math.BigDecimal number;
        try {
            number = value instanceof Number n ? new java.math.BigDecimal(n.toString())
                    : value instanceof String text ? new java.math.BigDecimal(text.trim()) : null;
        } catch (NumberFormatException exception) {
            throw configurationFailure();
        }
        if (number == null || number.stripTrailingZeros().scale() > 0
                || number.signum() <= 0 || number.compareTo(java.math.BigDecimal.valueOf(MAX_LOOKUP_LIMIT)) > 0) {
            throw configurationFailure();
        }
        return number.intValueExact();
    }

    /**
     * Filters the rows of a normal values read by exact text match in one column. Row numbers come from the
     * range Sheets reports back, so a bare sheet name or an open range still yields true 1-based sheet rows.
     */
    private Map<String, Object> lookup(Request request, Map<String, Object> read) {
        String reported = read.get("range") instanceof String text ? text : request.range();
        Matcher start = RANGE_START.matcher(reported.substring(reported.lastIndexOf('!') + 1));
        int firstColumn = 0;
        int firstRow = 1;
        if (start.lookingAt()) {
            firstColumn = start.group(1) == null ? 0 : columnNumber(start.group(1));
            firstRow = start.group(2) == null ? 1 : Integer.parseInt(start.group(2));
        }
        int offset = request.lookupColumn() - firstColumn;
        if (offset < 0) {
            throw configurationFailure();
        }
        List<Object> matches = new ArrayList<>();
        boolean truncated = false;
        if (read.get("values") instanceof List<?> rows) {
            for (int index = 0; index < rows.size(); index++) {
                if (!(rows.get(index) instanceof List<?> cells) || offset >= cells.size()
                        || cells.get(offset) == null
                        || !matches(request.lookupValue(), JsonValues.scalarText(cells.get(offset)))) {
                    continue;
                }
                if (matches.size() == request.limit()) {
                    truncated = true;
                    break;
                }
                Map<String, Object> match = new LinkedHashMap<>();
                match.put("row", firstRow + index);
                match.put("values", cells);
                matches.add(match);
            }
        }
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("range", reported);
        output.put("rows", matches);
        output.put("count", matches.size());
        output.put("truncated", truncated);
        return output;
    }

    private List<List<Object>> parseValues(Object value) {
        if (!(value instanceof List<?> rows)) {
            throw configurationFailure();
        }
        List<List<Object>> parsed = new ArrayList<>(rows.size());
        for (Object row : rows) {
            if (!(row instanceof List<?> cells)) {
                throw configurationFailure();
            }
            List<Object> parsedCells = new ArrayList<>(cells.size());
            for (Object cell : cells) {
                if (!isJsonCell(cell)) {
                    throw configurationFailure();
                }
                parsedCells.add(cell);
            }
            parsed.add(parsedCells);
        }
        return parsed;
    }

    private boolean isJsonCell(Object cell) {
        if (cell == null || cell instanceof String || cell instanceof Boolean) {
            return true;
        }
        if (cell instanceof Byte || cell instanceof Short || cell instanceof Integer || cell instanceof Long
                || cell instanceof java.math.BigInteger || cell instanceof java.math.BigDecimal) {
            return true;
        }
        if (cell instanceof Float value) {
            return Float.isFinite(value);
        }
        return cell instanceof Double value && Double.isFinite(value);
    }

    private String requiredText(Object value) {
        if (!(value instanceof String text) || text.isBlank() || text.length() > MAX_TEXT_LENGTH
                || text.codePoints().anyMatch(Character::isISOControl)) {
            throw configurationFailure();
        }
        return text;
    }

    private UUID parseConnectionId(Object value) {
        if (!(value instanceof String text) || text.length() != 36) {
            throw configurationFailure();
        }
        try {
            UUID connectionId = UUID.fromString(text);
            if (!connectionId.toString().equalsIgnoreCase(text)) {
                throw new IllegalArgumentException();
            }
            return connectionId;
        } catch (IllegalArgumentException exception) {
            throw configurationFailure();
        }
    }

    private ResolvedConnection resolveConnection(Context context, UUID connectionId) {
        try {
            return workspaceConnections.resolve(context.workspaceId(), connectionId);
        } catch (ForbiddenException exception) {
            throw new NodeExecutor.Failure("CONNECTION_FORBIDDEN",
                    "The Google Sheets connection is not available to this workspace.", false);
        } catch (ConnectionReconnectRequiredException exception) {
            throw new NodeExecutor.Failure(ConnectionReconnectRequiredException.CODE,
                    "The Google Sheets connection must be reconnected: open Connections and reconnect it.", false);
        } catch (WorkspaceDependencyUnavailableException exception) {
            throw new NodeExecutor.Failure("CONNECTION_UNAVAILABLE",
                    "The connection service is unavailable.", true, true);
        } catch (RuntimeException exception) {
            throw new NodeExecutor.Failure("CONNECTION_UNAVAILABLE",
                    "The connection service is unavailable.", true, true);
        }
    }

    private Set<String> activeSecrets(ResolvedConnection connection) {
        try {
            return Set.copyOf(new LinkedHashSet<>(connection.auth().values()));
        } catch (RuntimeException exception) {
            throw new NodeExecutor.Failure("CONNECTION_CONFIGURATION_INVALID",
                    "The Google Sheets connection configuration is invalid.", false);
        }
    }

    private void reportAuthenticationRejected(UUID workspaceId, UUID connectionId, ResolvedConnection resolved) {
        try {
            workspaceConnections.reportAuthenticationRejected(workspaceId, connectionId, resolved);
        } catch (RuntimeException ignored) {
            // The provider confirmed rejection; keep its safe classification if Workspace is unavailable.
        }
    }

    private NodeExecutor.Failure configurationFailure() {
        return new NodeExecutor.Failure("CONFIGURATION_ERROR",
                "The Google Sheets node configuration is invalid.", false);
    }

    private record Request(
            String operation,
            String spreadsheetId,
            String range,
            List<List<Object>> values,
            UUID connectionId,
            String valueInputOption,
            int lookupColumn,
            String lookupValue,
            int limit) {
    }
}
