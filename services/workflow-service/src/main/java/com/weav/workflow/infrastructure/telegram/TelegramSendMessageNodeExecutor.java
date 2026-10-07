package com.weav.workflow.infrastructure.telegram;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.domain.exception.ForbiddenException;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Sends a text message from the workspace's own Telegram bot (token held by a TELEGRAM connection). */
@Component
public final class TelegramSendMessageNodeExecutor implements NodeExecutor {

    private static final String TYPE = "telegram.send_message";
    private static final int MAX_CHAT_ID_LENGTH = 128;
    private static final int MAX_TEXT_LENGTH = 4096;

    private final TelegramBotApiClient telegram;
    private final WorkspaceConnectionPort workspaceConnections;

    public TelegramSendMessageNodeExecutor(
            TelegramBotApiClient telegram, WorkspaceConnectionPort workspaceConnections) {
        this.telegram = Objects.requireNonNull(telegram, "telegram must not be null");
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
        if (resolvedConfig == null) {
            throw configurationFailure();
        }
        UUID connectionId = connectionId(resolvedConfig.get("connectionId"));
        String chatId = chatId(resolvedConfig.get("chatId"));
        String text = text(resolvedConfig.get("text"));
        Map<String, Object> options = options(resolvedConfig);
        ResolvedConnection connection = resolveConnection(context, connectionId);
        try {
            try {
                return new Result(telegram.sendMessage(connection, chatId, text, options), null);
            } catch (NodeExecutor.Failure failure) {
                if ("AUTHENTICATION_REJECTED".equals(failure.code())) {
                    reportAuthenticationRejected(context.workspaceId(), connectionId, connection);
                }
                throw failure;
            } catch (RuntimeException exception) {
                throw new NodeExecutor.Failure("HTTP_DEPENDENCY_UNAVAILABLE",
                        "Telegram is temporarily unavailable.", true);
            }
        } finally {
            connection.close();
        }
    }

    private ResolvedConnection resolveConnection(Context context, UUID connectionId) {
        ResolvedConnection connection;
        try {
            connection = workspaceConnections.resolve(context.workspaceId(), connectionId);
        } catch (ForbiddenException exception) {
            throw new NodeExecutor.Failure("CONNECTION_FORBIDDEN",
                    "The Telegram connection is not available to this workspace.", false);
        } catch (WorkspaceDependencyUnavailableException exception) {
            throw new NodeExecutor.Failure("CONNECTION_UNAVAILABLE",
                    "The connection service is unavailable.", true, true);
        } catch (RuntimeException exception) {
            throw new NodeExecutor.Failure("CONNECTION_UNAVAILABLE",
                    "The connection service is unavailable.", true, true);
        }
        if (connection == null) {
            throw new NodeExecutor.Failure("CONNECTION_UNAVAILABLE",
                    "The Telegram connection is unavailable.", true, true);
        }
        return connection;
    }

    private void reportAuthenticationRejected(UUID workspaceId, UUID connectionId, ResolvedConnection resolved) {
        try {
            workspaceConnections.reportAuthenticationRejected(workspaceId, connectionId, resolved);
        } catch (RuntimeException ignored) {
            // Telegram confirmed the rejection; keep that classification if Workspace is unavailable.
        }
    }

    private UUID connectionId(Object value) {
        if (!(value instanceof String text) || text.length() != 36) {
            throw configurationFailure();
        }
        try {
            UUID id = UUID.fromString(text);
            if (!id.toString().equalsIgnoreCase(text)) {
                throw new IllegalArgumentException();
            }
            return id;
        } catch (IllegalArgumentException exception) {
            throw configurationFailure();
        }
    }

    /** A mapping such as the trigger's chat id resolves to a number; Telegram accepts it as text. */
    private String chatId(Object value) {
        String chatId;
        if (value instanceof String text) {
            chatId = text.strip();
        } else if (value instanceof Number number && isIntegral(number)) {
            chatId = new BigDecimal(number.toString()).toBigIntegerExact().toString();
        } else {
            throw configurationFailure();
        }
        if (chatId.isEmpty() || chatId.length() > MAX_CHAT_ID_LENGTH
                || chatId.codePoints().anyMatch(Character::isISOControl)) {
            throw configurationFailure();
        }
        return chatId;
    }

    private String text(Object value) {
        String text = value instanceof String s ? s
                : value instanceof Number || value instanceof Boolean ? String.valueOf(value) : null;
        if (text == null || text.isBlank() || text.length() > MAX_TEXT_LENGTH) {
            throw configurationFailure();
        }
        return text;
    }

    /** Optional Bot API fields; each is added only when set, so an old config sends exactly what it sent before. */
    private Map<String, Object> options(Map<String, Object> config) {
        Map<String, Object> options = new LinkedHashMap<>();
        Object parseMode = config.get("parseMode");
        if (parseMode instanceof String mode && !mode.isBlank() && !"none".equals(mode)) {
            if (!"HTML".equals(mode) && !"MarkdownV2".equals(mode)) {
                throw configurationFailure();
            }
            options.put("parse_mode", mode);
        } else if (parseMode != null && !(parseMode instanceof String)) {
            throw configurationFailure();
        }
        if (flag(config.get("disableNotification"))) {
            options.put("disable_notification", true);
        }
        Long replyTo = messageId(config.get("replyToMessageId"));
        if (replyTo != null) {
            // allow_sending_without_reply: a deleted original must not fail the send.
            options.put("reply_parameters", Map.of("message_id", replyTo, "allow_sending_without_reply", true));
        }
        return options;
    }

    private boolean flag(Object value) {
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

    /** A positive whole number, literal or mapped; a numeric string is accepted. */
    private Long messageId(Object value) {
        if (value == null || value instanceof String text && text.isBlank()) {
            return null;
        }
        String text = value instanceof String s ? s.strip() : value instanceof Number number ? number.toString() : null;
        try {
            long id = new BigDecimal(text).toBigIntegerExact().longValueExact();
            if (id > 0) {
                return id;
            }
        } catch (ArithmeticException | NumberFormatException | NullPointerException exception) {
            // fall through to the configuration failure
        }
        throw configurationFailure();
    }

    private static boolean isIntegral(Number number) {
        try {
            new BigDecimal(number.toString()).toBigIntegerExact();
            return true;
        } catch (ArithmeticException | NumberFormatException exception) {
            return false;
        }
    }

    private NodeExecutor.Failure configurationFailure() {
        return new NodeExecutor.Failure("CONFIGURATION_ERROR",
                "The Telegram node configuration is invalid.", false);
    }
}
