package com.weav.workflow.infrastructure.google;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ConnectionReconnectRequiredException;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.infrastructure.http.OutputSanitizer;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

/**
 * Shared flow of the Google Calendar and Drive nodes: validate the config, resolve the Workspace OAuth
 * connection, run one provider call, sanitize the output and report a rejected token back to Workspace.
 */
abstract class GoogleApiNodeExecutor implements NodeExecutor {

    private static final int MAX_TEXT_LENGTH = 8 * 1024;

    private final WorkspaceConnectionPort workspaceConnections;
    private final String service;

    GoogleApiNodeExecutor(WorkspaceConnectionPort workspaceConnections, String service) {
        this.workspaceConnections = Objects.requireNonNull(
                workspaceConnections, "workspaceConnections must not be null");
        this.service = service;
    }

    /** Validates the whole config without any I/O; throws CONFIGURATION_ERROR when it is invalid. */
    abstract Call prepare(Map<String, Object> config);

    /** A validated invocation: the connection to resolve and the provider call to run with it. */
    record Call(UUID connectionId, Function<ResolvedConnection, Map<String, Object>> run) {
    }

    @Override
    public final Result execute(Context context, Map<String, Object> resolvedConfig) {
        Objects.requireNonNull(context, "context must not be null");
        if (resolvedConfig == null) {
            throw configurationFailure();
        }
        Call call = prepare(resolvedConfig);
        ResolvedConnection connection = resolveConnection(context, call.connectionId());
        if (connection == null) {
            throw new NodeExecutor.Failure("CONNECTION_UNAVAILABLE",
                    "The " + service + " connection is unavailable.", true, true);
        }
        try {
            Set<String> activeSecrets = activeSecrets(connection);
            Map<String, Object> providerOutput;
            try {
                providerOutput = call.run().apply(connection);
            } catch (NodeExecutor.Failure failure) {
                if ("AUTHENTICATION_REJECTED".equals(failure.code())) {
                    reportAuthenticationRejected(context.workspaceId(), call.connectionId(), connection);
                }
                throw failure;
            } catch (RuntimeException exception) {
                throw new NodeExecutor.Failure("HTTP_DEPENDENCY_UNAVAILABLE",
                        "The " + service + " provider is temporarily unavailable.", true);
            }
            Object sanitized = OutputSanitizer.sanitize(providerOutput, activeSecrets);
            if (!(sanitized instanceof Map<?, ?> output)) {
                throw new NodeExecutor.Failure("HTTP_INVALID_RESPONSE",
                        "The " + service + " provider returned an invalid response.", true);
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

    final NodeExecutor.Failure configurationFailure() {
        return GoogleApiClient.configurationFailure(service);
    }

    /** A required single-line text value: nonblank, bounded, no control characters. */
    final String requiredText(Object value, int maxLength) {
        if (!(value instanceof String text) || text.isBlank() || text.length() > maxLength
                || text.codePoints().anyMatch(Character::isISOControl)) {
            throw configurationFailure();
        }
        return text;
    }

    /** An optional single-line text value; absent, null or blank means not set. */
    final String optionalText(Object value, int maxLength) {
        if (value == null || value instanceof String text && text.isBlank()) {
            return null;
        }
        return requiredText(value, maxLength);
    }

    /** An optional multi-line text value (newlines and tabs allowed). */
    final String optionalMultilineText(Object value) {
        if (value == null) {
            return null;
        }
        if (!(value instanceof String text) || text.length() > MAX_TEXT_LENGTH
                || text.codePoints().anyMatch(c -> Character.isISOControl(c) && c != '\n' && c != '\r' && c != '\t')) {
            throw configurationFailure();
        }
        return text.isBlank() ? null : text;
    }

    final UUID parseConnectionId(Object value) {
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
                    "The " + service + " connection is not available to this workspace.", false);
        } catch (ConnectionReconnectRequiredException exception) {
            throw new NodeExecutor.Failure(ConnectionReconnectRequiredException.CODE,
                    "The " + service + " connection must be reconnected: open Connections and reconnect it.", false);
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
                    "The " + service + " connection configuration is invalid.", false);
        }
    }

    private void reportAuthenticationRejected(UUID workspaceId, UUID connectionId, ResolvedConnection resolved) {
        try {
            workspaceConnections.reportAuthenticationRejected(workspaceId, connectionId, resolved);
        } catch (RuntimeException ignored) {
            // The provider confirmed rejection; keep its safe classification if Workspace is unavailable.
        }
    }
}
