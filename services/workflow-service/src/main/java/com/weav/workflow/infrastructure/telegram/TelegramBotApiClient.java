package com.weav.workflow.infrastructure.telegram;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Bounded client for the three Telegram Bot API methods Weav uses. The host is fixed and the bot token only
 * lives in the request path, so it is never logged, echoed in a failure or kept after the call.
 */
@Component
public class TelegramBotApiClient {

    private static final String BASE_URL = "https://api.telegram.org/bot";
    private static final Pattern BOT_TOKEN = Pattern.compile("[0-9]{1,20}:[A-Za-z0-9_-]{1,128}");
    private static final int MAX_DESCRIPTION_LENGTH = 200;
    private static final Duration DEFAULT_CONTROL_TIMEOUT = Duration.ofSeconds(10);
    private static final Duration MAX_CONTROL_TIMEOUT = Duration.ofSeconds(60);

    private final PinnedHttpTransport transport;
    private final Duration controlTimeout;

    public TelegramBotApiClient(PinnedHttpTransport transport) {
        this(transport, DEFAULT_CONTROL_TIMEOUT);
    }

    /**
     * @param controlTimeout call timeout for setWebhook/deleteWebhook, which run inside the publish transaction;
     *                       sendMessage keeps the transport's normal call timeout
     */
    @Autowired
    public TelegramBotApiClient(
            PinnedHttpTransport transport,
            @Value("${weav.workflow.telegram.control-timeout:10s}") Duration controlTimeout) {
        this.transport = Objects.requireNonNull(transport, "transport must not be null");
        this.controlTimeout = Objects.requireNonNull(controlTimeout, "controlTimeout must not be null");
        if (controlTimeout.isZero() || controlTimeout.isNegative() || controlTimeout.compareTo(MAX_CONTROL_TIMEOUT) > 0) {
            throw new IllegalArgumentException("weav.workflow.telegram.control-timeout must be between 1 ms and 60 s");
        }
    }

    /** Sends a text message and returns {@code messageId} and {@code chatId} from Telegram's answer. */
    public Map<String, Object> sendMessage(ResolvedConnection connection, String chatId, String text) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("chat_id", chatId);
        body.put("text", text);
        Map<String, Object> result = call(connection, "sendMessage", body, null);
        Map<String, Object> output = new LinkedHashMap<>();
        if (result.get("message_id") instanceof Number messageId) {
            output.put("messageId", messageId.longValue());
        }
        if (result.get("chat") instanceof Map<?, ?> chat && chat.get("id") instanceof Number id) {
            output.put("chatId", id.longValue());
        }
        if (!output.containsKey("messageId")) {
            throw invalidResponse();
        }
        return output;
    }

    /** Points the bot at {@code webhookUrl}; Telegram echoes {@code secretToken} in a header on every update. */
    public void setWebhook(ResolvedConnection connection, String webhookUrl, String secretToken) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("url", webhookUrl);
        body.put("secret_token", secretToken);
        body.put("allowed_updates", List.of("message"));
        call(connection, "setWebhook", body, controlTimeout);
    }

    public void deleteWebhook(ResolvedConnection connection) {
        call(connection, "deleteWebhook", Map.of(), controlTimeout);
    }

    private Map<String, Object> call(
            ResolvedConnection connection, String method, Map<String, Object> body, Duration timeout) {
        String token = botToken(connection);
        PinnedHttpTransport.HttpResponse response =
                transport.executeTelegramBotApi(URI.create(BASE_URL + token + "/" + method), body, timeout);
        return successfulResult(response, token);
    }

    private Map<String, Object> successfulResult(PinnedHttpTransport.HttpResponse response, String token) {
        if (response == null) {
            throw invalidResponse();
        }
        int status = response.status();
        Map<String, Object> envelope = response.data() instanceof Map<?, ?> map ? stringKeys(map) : Map.of();
        if (status >= 200 && status < 300) {
            if (!Boolean.TRUE.equals(envelope.get("ok"))) {
                throw invalidResponse();
            }
            Object result = envelope.get("result");
            return result instanceof Map<?, ?> map ? stringKeys(map) : Map.of();
        }
        if (status == 401) {
            throw new NodeExecutor.Failure("AUTHENTICATION_REJECTED",
                    "Telegram rejected the bot token of this connection.", false);
        }
        if (status == 429) {
            // The runtime retries on its own 1 s / 2 s schedule; Telegram's retry_after is not honoured.
            throw new NodeExecutor.Failure("HTTP_RATE_LIMITED",
                    "Telegram rate limited the request.", true, true);
        }
        if (status == 408 || status >= 500) {
            throw new NodeExecutor.Failure("HTTP_DEPENDENCY_UNAVAILABLE",
                    "Telegram is temporarily unavailable.", true);
        }
        if (status >= 300 && status < 400) {
            throw new NodeExecutor.Failure("HTTP_REDIRECT_REJECTED",
                    "Telegram returned a redirect that is not followed.", false);
        }
        if (status >= 400) {
            // 400, 403 and 404 are permanent for this request: bad chat, blocked bot, unknown method.
            throw new NodeExecutor.Failure("HTTP_BUSINESS_REJECTED",
                    "Telegram rejected the request" + describe(envelope, token) + ".", false, true);
        }
        throw invalidResponse();
    }

    private static String describe(Map<String, Object> envelope, String token) {
        if (!(envelope.get("description") instanceof String description) || description.isBlank()) {
            return "";
        }
        String clean = description.replace(token, "***").replaceAll("[\\x00-\\x1F\\x7F]+", " ").trim();
        if (clean.length() > MAX_DESCRIPTION_LENGTH) {
            clean = clean.substring(0, MAX_DESCRIPTION_LENGTH);
        }
        return ": " + clean;
    }

    private static Map<String, Object> stringKeys(Map<?, ?> source) {
        Map<String, Object> result = new LinkedHashMap<>();
        source.forEach((key, value) -> {
            if (key instanceof String name) {
                result.put(name, value);
            }
        });
        return result;
    }

    private static String botToken(ResolvedConnection connection) {
        try {
            if (connection == null
                    || !"TELEGRAM".equals(connection.provider())
                    || !"TOKEN".equals(connection.authType())
                    || !connection.auth().keySet().equals(java.util.Set.of("token"))) {
                throw invalidConnection();
            }
            String token = connection.auth().get("token");
            if (token == null || !BOT_TOKEN.matcher(token).matches()) {
                throw invalidConnection();
            }
            return token;
        } catch (NodeExecutor.Failure failure) {
            throw failure;
        } catch (RuntimeException exception) {
            throw invalidConnection();
        }
    }

    private static NodeExecutor.Failure invalidConnection() {
        return new NodeExecutor.Failure("CONNECTION_CONFIGURATION_INVALID",
                "The Telegram connection configuration is invalid.", false);
    }

    private static NodeExecutor.Failure invalidResponse() {
        return new NodeExecutor.Failure("HTTP_INVALID_RESPONSE",
                "Telegram returned an invalid response.", true);
    }
}
