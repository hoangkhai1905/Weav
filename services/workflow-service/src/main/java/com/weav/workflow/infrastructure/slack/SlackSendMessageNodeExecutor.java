package com.weav.workflow.infrastructure.slack;

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
 * Posts a message to Slack through the webhook URL held by a SLACK connection. The URL carries its own secret,
 * so it is never logged, echoed in a failure or kept after the call.
 */
@Component
public final class SlackSendMessageNodeExecutor implements NodeExecutor {

    private static final java.util.regex.Pattern WEBHOOK_URL = java.util.regex.Pattern.compile(
            "^https://hooks\\.slack\\.com/services/T[A-Z0-9]{1,20}/B[A-Z0-9]{1,20}/[A-Za-z0-9]{1,64}$");
    private static final String TYPE = "slack.send_message";
    private static final int MAX_TEXT = 4000;
    private static final long MAX_RETRY_AFTER_SECONDS = 3600;

    private final PinnedHttpTransport transport;
    private final WorkspaceConnectionPort workspaceConnections;

    public SlackSendMessageNodeExecutor(PinnedHttpTransport transport, WorkspaceConnectionPort workspaceConnections) {
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
        ResolvedConnection connection = resolveConnection(context, connectionId);
        try {
            URI webhook = webhook(connection);
            Object body = Map.of("text", escapeSlack(text));
            PinnedHttpTransport.HttpResponse response;
            try {
                response = transport.executeSlackWebhook(webhook, body);
            } catch (NodeExecutor.Failure failure) {
                throw failure;
            } catch (RuntimeException exception) {
                throw new Failure("HTTP_DEPENDENCY_UNAVAILABLE", "Slack is temporarily unavailable.", true);
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
                    "Slack rejected the webhook of this connection (it may have been deleted).", false);
        }
        if (status == 429) {
            long seconds = retryAfterSeconds(response);
            throw new Failure("HTTP_RATE_LIMITED", "Slack rate limited the request"
                    + (seconds > 0 ? "; it asked to retry after " + seconds + " s" : "") + ".", true, true);
        }
        if (status == 408 || status >= 500 || status == 0) {
            throw new Failure("HTTP_DEPENDENCY_UNAVAILABLE", "Slack is temporarily unavailable.", true);
        }
        if (status >= 300 && status < 400) {
            throw new Failure("HTTP_REDIRECT_REJECTED", "Slack returned a redirect that is not followed.", false);
        }
        // Other 4xx (for example 400, 403, 410 channel_is_archived) are permanent; the response text is never echoed.
        throw new Failure("HTTP_BUSINESS_REJECTED", "Slack rejected the request (HTTP " + status + ").", false, true);
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
            if (connection == null || !"SLACK".equals(connection.provider())
                    || !"TOKEN".equals(connection.authType())
                    || !connection.auth().keySet().equals(Set.of("token"))) {
                throw invalidConnection();
            }
            String url = connection.auth().get("token");
            if (url == null) {
                throw invalidConnection();
            }
            if (!WEBHOOK_URL.matcher(url).matches()) {
                throw invalidConnection();
            }
            return URI.create(url);
        } catch (NodeExecutor.Failure failure) {
            throw failure;
        } catch (RuntimeException exception) {
            throw invalidConnection();
        }
    }

    private static Failure invalidConnection() {
        return new Failure("CONNECTION_CONFIGURATION_INVALID", "The Slack connection configuration is invalid.", false);
    }

    private ResolvedConnection resolveConnection(Context context, UUID connectionId) {
        ResolvedConnection connection;
        try {
            connection = workspaceConnections.resolve(context.workspaceId(), connectionId);
        } catch (ForbiddenException exception) {
            throw new Failure("CONNECTION_FORBIDDEN", "The Slack connection is not available to this workspace.", false);
        } catch (WorkspaceDependencyUnavailableException exception) {
            throw new Failure("CONNECTION_UNAVAILABLE", "The connection service is unavailable.", true, true);
        } catch (RuntimeException exception) {
            throw new Failure("CONNECTION_UNAVAILABLE", "The connection service is unavailable.", true, true);
        }
        if (connection == null) {
            throw new Failure("CONNECTION_UNAVAILABLE", "The Slack connection is unavailable.", true, true);
        }
        return connection;
    }

    private void reportAuthenticationRejected(UUID workspaceId, UUID connectionId, ResolvedConnection resolved) {
        try {
            workspaceConnections.reportAuthenticationRejected(workspaceId, connectionId, resolved);
        } catch (RuntimeException ignored) {
            // Slack confirmed the rejection; keep that classification if Workspace is unavailable.
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

    /** Slack control characters (mrkdwn): escaped so upstream data cannot ping <!channel> or craft <url|label> links. */
    static String escapeSlack(String text) {
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
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
}
