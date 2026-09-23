package com.weav.workflow.infrastructure.sheets;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
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

/** Executes V1 Google Sheets values operations using Workspace-owned OAuth credentials. */
@Component
public final class GoogleSheetsNodeExecutor implements NodeExecutor {

    private static final String TYPE = "google.sheets";
    private static final int MAX_TEXT_LENGTH = 8 * 1024;

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
                    "The Google Sheets connection is unavailable.", true);
        }

        try {
            Set<String> activeSecrets = activeSecrets(connection);
            Map<String, Object> providerOutput;
            try {
                providerOutput = switch (request.operation()) {
                    case "read" -> sheetsClient.read(request.spreadsheetId(), request.range(), connection);
                    case "append" -> sheetsClient.append(
                            request.spreadsheetId(), request.range(), request.values(), connection);
                    case "update" -> sheetsClient.update(
                            request.spreadsheetId(), request.range(), request.values(), connection);
                    default -> throw configurationFailure();
                };
            } catch (NodeExecutor.Failure failure) {
                if ("AUTHENTICATION_REJECTED".equals(failure.code())) {
                    reportAuthenticationRejected(context.workspaceId(), request.connectionId());
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
        if (!Set.of("read", "append", "update").contains(operation)) {
            throw configurationFailure();
        }
        UUID connectionId = parseConnectionId(config.get("connectionId"));
        String spreadsheetId = requiredText(config.get("spreadsheetId"));
        String range = requiredText(config.get("range"));
        List<List<Object>> values = null;
        if (!"read".equals(operation)) {
            values = parseValues(config.get("values"));
        }
        return new Request(operation, spreadsheetId, range, values, connectionId);
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
        } catch (WorkspaceDependencyUnavailableException exception) {
            throw new NodeExecutor.Failure("CONNECTION_UNAVAILABLE",
                    "The connection service is unavailable.", true);
        } catch (RuntimeException exception) {
            throw new NodeExecutor.Failure("CONNECTION_UNAVAILABLE",
                    "The connection service is unavailable.", true);
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

    private void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
        try {
            workspaceConnections.reportAuthenticationRejected(workspaceId, connectionId);
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
            UUID connectionId) {
    }
}
