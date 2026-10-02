package com.weav.workflow.infrastructure.gmail;

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
import java.util.regex.Pattern;

/** Sends a plain-text email through the Workspace-owned Gmail connection. */
@Component
public final class GmailNodeExecutor implements NodeExecutor {

    private static final String TYPE = "email.send";
    static final int MAX_RECIPIENTS = 10;
    private static final int MAX_ADDRESS_LENGTH = 254;
    private static final int MAX_SUBJECT_LENGTH = 998;
    static final int MAX_BODY_LENGTH = 64 * 1024;
    // ponytail: pragmatic address shape check; Gmail performs full RFC 5322 validation.
    private static final Pattern ADDRESS = Pattern.compile("[^@\\s,;<>\"()\\[\\]]+@[^@\\s,;<>\"()\\[\\]]+\\.[^@\\s,;<>\"()\\[\\]]+");

    private final GmailClient gmailClient;
    private final WorkspaceConnectionPort workspaceConnections;

    public GmailNodeExecutor(GmailClient gmailClient, WorkspaceConnectionPort workspaceConnections) {
        this.gmailClient = Objects.requireNonNull(gmailClient, "gmailClient must not be null");
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
                    "The Gmail connection is unavailable.", true, true);
        }

        try {
            Set<String> activeSecrets = activeSecrets(connection);
            Map<String, Object> providerOutput;
            try {
                providerOutput = gmailClient.send(request.recipients(), request.subject(), request.body(), connection);
            } catch (NodeExecutor.Failure failure) {
                if ("AUTHENTICATION_REJECTED".equals(failure.code())) {
                    reportAuthenticationRejected(context.workspaceId(), request.connectionId(), connection);
                }
                throw failure;
            } catch (RuntimeException exception) {
                // The message may already have been sent; never retry into a duplicate email.
                throw new NodeExecutor.Failure("HTTP_DEPENDENCY_UNAVAILABLE",
                        "The Gmail request outcome is unknown and is not retried to avoid duplicate emails.", false);
            }

            Object sanitized = OutputSanitizer.sanitize(providerOutput, activeSecrets);
            if (!(sanitized instanceof Map<?, ?> output)) {
                throw new NodeExecutor.Failure("HTTP_INVALID_RESPONSE",
                        "The Gmail provider returned an invalid response.", false);
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
        UUID connectionId = parseConnectionId(config.get("connectionId"));
        List<String> recipients = parseRecipients(config.get("to"));
        String subject = config.get("subject") instanceof String text ? text : null;
        if (subject == null || subject.isBlank() || subject.length() > MAX_SUBJECT_LENGTH
                || subject.codePoints().anyMatch(Character::isISOControl)) {
            throw configurationFailure();
        }
        Object rawBody = config.getOrDefault("body", "");
        if (!(rawBody instanceof String body) || body.length() > MAX_BODY_LENGTH
                || body.codePoints().anyMatch(c -> Character.isISOControl(c) && c != '\n' && c != '\r' && c != '\t')) {
            throw configurationFailure();
        }
        return new Request(connectionId, recipients, subject, body);
    }

    static List<String> parseRecipients(Object value) {
        List<Object> candidates = new ArrayList<>();
        if (value instanceof String text) {
            candidates.addAll(List.of(text.split(",", -1)));
        } else if (value instanceof List<?> list) {
            candidates.addAll(list);
        } else {
            throw configurationFailure();
        }
        List<String> recipients = new ArrayList<>();
        for (Object candidate : candidates) {
            if (!(candidate instanceof String raw)) {
                throw configurationFailure();
            }
            String address = raw.trim();
            if (address.isEmpty() || address.length() > MAX_ADDRESS_LENGTH
                    || address.codePoints().anyMatch(Character::isISOControl)
                    || !ADDRESS.matcher(address).matches()) {
                throw configurationFailure();
            }
            recipients.add(address);
        }
        if (recipients.isEmpty() || recipients.size() > MAX_RECIPIENTS) {
            throw configurationFailure();
        }
        return List.copyOf(recipients);
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
                    "The Gmail connection is not available to this workspace.", false);
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
                    "The Gmail connection configuration is invalid.", false);
        }
    }

    private void reportAuthenticationRejected(UUID workspaceId, UUID connectionId, ResolvedConnection resolved) {
        try {
            workspaceConnections.reportAuthenticationRejected(workspaceId, connectionId, resolved);
        } catch (RuntimeException ignored) {
            // The provider confirmed rejection; keep its safe classification if Workspace is unavailable.
        }
    }

    private static NodeExecutor.Failure configurationFailure() {
        return new NodeExecutor.Failure("CONFIGURATION_ERROR",
                "The email node configuration is invalid.", false);
    }

    private record Request(UUID connectionId, List<String> recipients, String subject, String body) {
    }
}
