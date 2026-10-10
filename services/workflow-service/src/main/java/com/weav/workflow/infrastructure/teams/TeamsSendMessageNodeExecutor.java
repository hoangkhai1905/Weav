package com.weav.workflow.infrastructure.teams;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Posts a message to Teams through the webhook URL held by a TEAMS connection. The URL carries its own secret,
 * so it is never logged, echoed in a failure or kept after the call.
 */
@Component
public final class TeamsSendMessageNodeExecutor implements NodeExecutor {

    private static final String TYPE = "teams.send_message";
    private static final int MAX_TEXT = 4000;
    private static final int MAX_TITLE = 200;
    private static final long MAX_RETRY_AFTER_SECONDS = 3600;

    private final PinnedHttpTransport transport;
    private final WorkspaceConnectionPort workspaceConnections;

    public TeamsSendMessageNodeExecutor(PinnedHttpTransport transport, WorkspaceConnectionPort workspaceConnections) {
        this.transport = Objects.requireNonNull(transport, "transport must not be null");
        this.workspaceConnections = Objects.requireNonNull(
                workspaceConnections, "workspaceConnections must not be null");
    }

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    public Result execute(Context context, Map<String, Object> config) {
        Objects.requireNonNull(context, "context must not be null");
        if (config == null) {
            throw Failure.invalidField("connectionId", "is required.");
        }
        UUID connectionId = connectionId(config.get("connectionId"));
        String text = text(config.get("text"));
        String title = title(config.get("title"));
        ResolvedConnection connection = resolveConnection(context, connectionId);
        try {
            URI webhook = webhook(connection);
            Object body = teamsCard(title, text);
            PinnedHttpTransport.HttpResponse response;
            try {
                response = transport.executeTeamsWebhook(webhook, body);
            } catch (NodeExecutor.Failure failure) {
                throw failure;
            } catch (RuntimeException exception) {
                throw new Failure("HTTP_DEPENDENCY_UNAVAILABLE", "Teams is temporarily unavailable.", true);
            }
            try {
                return new Result(interpret(response), null);
            } catch (NodeExecutor.Failure failure) {
                if ("AUTHENTICATION_REJECTED".equals(failure.code())) {
                    reportAuthenticationRejected(context.workspaceId(), connectionId, connection);
                }
                throw failure;
            }
        } finally {
            connection.close();
        }
    }

    private static Map<String, Object> interpret(PinnedHttpTransport.HttpResponse response) {
        int status = response == null ? 0 : response.status();
        if (status >= 200 && status < 300) {
            return Map.of("sent", true);
        }
        if (status == 401 || status == 404) {
            throw new Failure("AUTHENTICATION_REJECTED",
                    "Teams rejected the webhook of this connection (it may have been deleted).", false);
        }
        if (status == 429) {
            long seconds = retryAfterSeconds(response);
            throw new Failure("HTTP_RATE_LIMITED", "Teams rate limited the request"
                    + (seconds > 0 ? "; it asked to retry after " + seconds + " s" : "") + ".", true, true);
        }
        if (status == 408 || status >= 500 || status == 0) {
            throw new Failure("HTTP_DEPENDENCY_UNAVAILABLE", "Teams is temporarily unavailable.", true);
        }
        if (status >= 300 && status < 400) {
            throw new Failure("HTTP_REDIRECT_REJECTED", "Teams returned a redirect that is not followed.", false);
        }
        // Other 4xx (for example 400, 403, 410 channel_is_archived) are permanent; the response text is never echoed.
        throw new Failure("HTTP_BUSINESS_REJECTED", "Teams rejected the request (HTTP " + status + ").", false, true);
    }

    private static long retryAfterSeconds(PinnedHttpTransport.HttpResponse response) {
        String value = response.headers().entrySet().stream()
                .filter(entry -> "retry-after".equalsIgnoreCase(entry.getKey()))
                .map(Map.Entry::getValue).findFirst().orElse(null);
        if (value == null) {
            return 0;
        }
        try {
            long seconds = new BigDecimal(value.strip()).setScale(0, java.math.RoundingMode.UP).longValueExact();
            return Math.max(0, Math.min(MAX_RETRY_AFTER_SECONDS, seconds));
        } catch (ArithmeticException | NumberFormatException exception) {
            return 0;
        }
    }

    private static URI webhook(ResolvedConnection connection) {
        try {
            if (connection == null || !"TEAMS".equals(connection.provider())
                    || !"TOKEN".equals(connection.authType())
                    || !connection.auth().keySet().equals(Set.of("token"))) {
                throw invalidConnection();
            }
            String url = connection.auth().get("token");
            if (url == null) {
                throw invalidConnection();
            }
            URI uri = URI.create(url);
            if (!PinnedHttpTransport.isTeamsWebhookUri(uri)) {
                throw invalidConnection();
            }
            return uri;
        } catch (NodeExecutor.Failure failure) {
            throw failure;
        } catch (RuntimeException exception) {
            throw invalidConnection();
        }
    }

    private static Failure invalidConnection() {
        return new Failure("CONNECTION_CONFIGURATION_INVALID", "The Teams connection configuration is invalid.", false);
    }

    private ResolvedConnection resolveConnection(Context context, UUID connectionId) {
        ResolvedConnection connection;
        try {
            connection = workspaceConnections.resolve(context.workspaceId(), connectionId);
        } catch (ForbiddenException exception) {
            throw new Failure("CONNECTION_FORBIDDEN", "The Teams connection is not available to this workspace.", false);
        } catch (WorkspaceDependencyUnavailableException exception) {
            throw new Failure("CONNECTION_UNAVAILABLE", "The connection service is unavailable.", true, true);
        } catch (RuntimeException exception) {
            throw new Failure("CONNECTION_UNAVAILABLE", "The connection service is unavailable.", true, true);
        }
        if (connection == null) {
            throw new Failure("CONNECTION_UNAVAILABLE", "The Teams connection is unavailable.", true, true);
        }
        return connection;
    }

    private void reportAuthenticationRejected(UUID workspaceId, UUID connectionId, ResolvedConnection resolved) {
        try {
            workspaceConnections.reportAuthenticationRejected(workspaceId, connectionId, resolved);
        } catch (RuntimeException ignored) {
            // Teams confirmed the rejection; keep that classification if Workspace is unavailable.
        }
    }

    private static UUID connectionId(Object value) {
        if (!(value instanceof String text) || text.length() != 36) {
            throw Failure.invalidField("connectionId", "must be a connection id.");
        }
        try {
            UUID id = UUID.fromString(text);
            if (!id.toString().equalsIgnoreCase(text)) {
                throw new IllegalArgumentException();
            }
            return id;
        } catch (IllegalArgumentException exception) {
            throw Failure.invalidField("connectionId", "must be a connection id.");
        }
    }

    private static String text(Object value) {
        String text = value instanceof String s ? s
                : value instanceof Number || value instanceof Boolean ? String.valueOf(value) : null;
        if (text == null || text.isBlank()) {
            throw Failure.invalidField("text", "is required.");
        }
        if (text.codePointCount(0, text.length()) > MAX_TEXT) {
            throw Failure.invalidField("text", "must be at most 4000 characters.");
        }
        return text;
    }

    private static String title(Object value) {
        if (value == null || value instanceof String text && text.isBlank()) {
            return null;
        }
        if (!(value instanceof String text) || text.codePointCount(0, text.length()) > MAX_TITLE) {
            throw Failure.invalidField("title", "must be text of at most 200 characters.");
        }
        return text.strip();
    }

    private static Map<String, Object> teamsCard(String title, String text) {
        List<Object> blocks = new java.util.ArrayList<>();
        if (title != null) {
            Map<String, Object> heading = new LinkedHashMap<>();
            heading.put("type", "TextBlock");
            heading.put("text", title);
            heading.put("weight", "Bolder");
            heading.put("wrap", true);
            blocks.add(heading);
        }
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("type", "TextBlock");
        message.put("text", text);
        message.put("wrap", true);
        blocks.add(message);
        Map<String, Object> content = new LinkedHashMap<>();
        content.put("$schema", "http://adaptivecards.io/schemas/adaptive-card.json");
        content.put("type", "AdaptiveCard");
        content.put("version", "1.4");
        content.put("body", blocks);
        Map<String, Object> attachment = new LinkedHashMap<>();
        attachment.put("contentType", "application/vnd.microsoft.card.adaptive");
        attachment.put("contentUrl", null);
        attachment.put("content", content);
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("type", "message");
        envelope.put("attachments", List.of(attachment));
        return envelope;
    }
}
