package com.weav.workflow.infrastructure.gmail;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Bounded client for the fixed Gmail messages.send endpoint. */
@Component
public class GmailClient {

    static final URI SEND_URI = URI.create("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    static final URI MESSAGES_URI = URI.create("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    private static final int MAX_ACCESS_TOKEN_LENGTH = 16 * 1024;
    // RFC 2047: an encoded word is at most 75 chars; 45 raw bytes -> 60 base64 chars + 12 framing.
    private static final int MAX_ENCODED_WORD_BYTES = 45;
    /** messages.list is read up to this many ids per poll (newest first). */
    static final int LIST_BOUND = 100;
    private static final Set<String> RATE_LIMIT_REASONS = Set.of("rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded");
    private static final Set<String> PERMISSION_REASONS = Set.of("insufficientPermissions", "authError", "forbiddenScope");
    private static final Set<String> ACCESS_TOKEN_FIELDS = Set.of("accessToken");

    private final PinnedHttpTransport transport;

    public GmailClient(PinnedHttpTransport transport) {
        this.transport = Objects.requireNonNull(transport, "transport must not be null");
    }

    /**
     * Sends one plain-text message. Recipients, subject, and body must already be validated
     * by the executor. Sending is not idempotent, so any failure after the request may have
     * reached Google is reported as non-retryable to avoid duplicate emails.
     */
    public Map<String, Object> send(
            List<String> recipients, String subject, String body, ResolvedConnection connection) {
        String accessToken = accessToken(connection);
        String raw = Base64.getUrlEncoder().encodeToString(
                mimeMessage(recipients, subject, body).getBytes(StandardCharsets.UTF_8));
        PinnedHttpTransport.HttpResponse response;
        try {
            response = transport.executeGmailSendWithBearerToken(SEND_URI, Map.of("raw", raw), accessToken);
        } catch (NodeExecutor.Failure failure) {
            if (failure.retryable()) {
                throw new NodeExecutor.Failure(failure.code(),
                        "The Gmail request outcome is unknown and is not retried to avoid duplicate emails.",
                        false);
            }
            throw failure;
        }
        return sentMessage(response);
    }

    /** Newest-first ids; {@code truncated} when more than {@link #LIST_BOUND} messages matched. */
    record Listing(List<String> ids, boolean truncated) {
    }

    /** {@code skippedCode} is set (and json null) when this one message cannot be read and is skipped. */
    record MessageRead(Map<?, ?> json, boolean bodyOmitted, String skippedCode) {
    }

    /**
     * Ids of up to {@link #LIST_BOUND} newest messages matching {@code q} (Gmail lists newest first), following
     * nextPageToken. Read-only, so safe to retry.
     */
    Listing listMessageIds(String q, ResolvedConnection connection) {
        String token = null;
        List<String> ids = new java.util.ArrayList<>();
        int pages = 0;
        do {
            Map<String, Object> query = new java.util.LinkedHashMap<>();
            query.put("q", q);
            query.put("maxResults", LIST_BOUND);
            if (token != null) {
                query.put("pageToken", token);
            }
            PinnedHttpTransport.HttpResponse response = transport.executeGmailGetWithBearerToken(
                    MESSAGES_URI, query, accessToken(connection));
            requireSuccess(response, true);
            token = null;
            if (response.data() instanceof Map<?, ?> map) {
                if (map.get("messages") instanceof List<?> messages) {
                    for (Object item : messages) {
                        if (item instanceof Map<?, ?> message && message.get("id") instanceof String id) {
                            ids.add(id);
                        }
                    }
                }
                token = map.get("nextPageToken") instanceof String next && !next.isBlank() ? next : null;
            }
        } while (token != null && ids.size() < LIST_BOUND && ++pages < 5);
        boolean truncated = token != null || ids.size() > LIST_BOUND;
        return new Listing(ids.size() > LIST_BOUND ? List.copyOf(ids.subList(0, LIST_BOUND)) : List.copyOf(ids),
                truncated);
    }

    /**
     * One message in full format. A message over the response cap is read again as metadata (headers and snippet)
     * with the body omitted. Other permanent per-message failures are returned as {@code skippedCode} so one bad
     * email cannot block the mailbox; credential, rate-limit and outage failures are thrown.
     */
    MessageRead getMessage(String id, ResolvedConnection connection) {
        try {
            return new MessageRead(readMessage(id, "full", connection), false, null);
        } catch (NodeExecutor.Failure failure) {
            if ("HTTP_RESPONSE_TOO_LARGE".equals(failure.code())) {
                try {
                    return new MessageRead(readMessage(id, "metadata", connection), true, null);
                } catch (NodeExecutor.Failure second) {
                    return skippedOrThrow(second);
                }
            }
            return skippedOrThrow(failure);
        }
    }

    private static MessageRead skippedOrThrow(NodeExecutor.Failure failure) {
        if (failure.retryable() || "AUTHENTICATION_REJECTED".equals(failure.code())
                || "CONNECTION_RECONNECT_REQUIRED".equals(failure.code())) {
            throw failure;
        }
        return new MessageRead(null, false, failure.code());
    }

    private Map<?, ?> readMessage(String id, String format, ResolvedConnection connection) {
        PinnedHttpTransport.HttpResponse response = transport.executeGmailGetWithBearerToken(
                URI.create(MESSAGES_URI + "/" + id), Map.of("format", format), accessToken(connection));
        requireSuccess(response, false);
        if (response.data() instanceof Map<?, ?> map) {
            return map;
        }
        throw new NodeExecutor.Failure("HTTP_INVALID_RESPONSE", "The Gmail provider returned an invalid response.", false);
    }

    private void requireSuccess(PinnedHttpTransport.HttpResponse response, boolean listing) {
        if (response == null) {
            throw new NodeExecutor.Failure("HTTP_DEPENDENCY_UNAVAILABLE", "The Gmail request failed.", true);
        }
        int status = response.status();
        if (status >= 200 && status < 300) {
            return;
        }
        if (status == 401) {
            throw new NodeExecutor.Failure("AUTHENTICATION_REJECTED",
                    "The Gmail provider rejected the configured credentials.", false);
        }
        if (status == 403) {
            if (isRateLimit(response.data())) {
                throw new NodeExecutor.Failure("HTTP_RATE_LIMITED",
                        "The Gmail provider rate limited the request.", true);
            }
            if (isPermissionDenied(response.data())) {
                throw new NodeExecutor.Failure("CONNECTION_RECONNECT_REQUIRED",
                        "Gmail refused read access; reconnect the Gmail connection to grant it.", false);
            }
            throw new NodeExecutor.Failure("HTTP_BUSINESS_REJECTED", "The Gmail provider refused the request.", false);
        }
        if (status == 429) {
            throw new NodeExecutor.Failure("HTTP_RATE_LIMITED", "The Gmail provider rate limited the request.", true);
        }
        if (status >= 500 || status == 408) {
            throw new NodeExecutor.Failure("HTTP_DEPENDENCY_UNAVAILABLE",
                    "The Gmail provider is unavailable.", true);
        }
        throw new NodeExecutor.Failure("HTTP_BUSINESS_REJECTED",
                listing ? "The Gmail provider rejected the search." : "The Gmail provider rejected the message read.",
                false);
    }

    /** Google reports quota errors as 403 with {@code error.errors[].reason}. */
    static boolean isRateLimit(Object data) {
        return hasReason(data, RATE_LIMIT_REASONS);
    }

    /** A 403 that really means the grant lacks access (missing scope), as opposed to quota or other refusals. */
    static boolean isPermissionDenied(Object data) {
        if (hasReason(data, PERMISSION_REASONS)) {
            return true;
        }
        return data instanceof Map<?, ?> root && root.get("error") instanceof Map<?, ?> error
                && "PERMISSION_DENIED".equals(error.get("status"));
    }

    private static boolean hasReason(Object data, Set<String> reasons) {
        if (data instanceof Map<?, ?> root && root.get("error") instanceof Map<?, ?> error
                && error.get("errors") instanceof List<?> errors) {
            return errors.stream().anyMatch(item -> item instanceof Map<?, ?> entry
                    && entry.get("reason") instanceof String reason && reasons.contains(reason));
        }
        return false;
    }

    static String mimeMessage(List<String> recipients, String subject, String body) {
        String encodedBody = Base64.getMimeEncoder().encodeToString(body.getBytes(StandardCharsets.UTF_8));
        return "To: " + String.join(", ", recipients) + "\r\n"
                + "Subject: " + encodeHeaderWords(subject) + "\r\n"
                + "MIME-Version: 1.0\r\n"
                + "Content-Type: text/plain; charset=UTF-8\r\n"
                + "Content-Transfer-Encoding: base64\r\n"
                + "\r\n"
                + encodedBody + "\r\n";
    }

    /** RFC 2047 B-encoding, split on code-point boundaries and folded across lines. */
    static String encodeHeaderWords(String text) {
        StringBuilder header = new StringBuilder();
        StringBuilder chunk = new StringBuilder();
        int chunkBytes = 0;
        for (int index = 0; index < text.length(); ) {
            int codePoint = text.codePointAt(index);
            String character = new String(Character.toChars(codePoint));
            int characterBytes = character.getBytes(StandardCharsets.UTF_8).length;
            if (chunkBytes + characterBytes > MAX_ENCODED_WORD_BYTES) {
                appendEncodedWord(header, chunk);
                chunk.setLength(0);
                chunkBytes = 0;
            }
            chunk.append(character);
            chunkBytes += characterBytes;
            index += Character.charCount(codePoint);
        }
        appendEncodedWord(header, chunk);
        return header.toString();
    }

    private static void appendEncodedWord(StringBuilder header, CharSequence chunk) {
        if (chunk.isEmpty()) {
            return;
        }
        if (!header.isEmpty()) {
            header.append("\r\n ");
        }
        header.append("=?UTF-8?B?")
                .append(Base64.getEncoder().encodeToString(chunk.toString().getBytes(StandardCharsets.UTF_8)))
                .append("?=");
    }

    String accessToken(ResolvedConnection connection) {
        try {
            if (connection == null
                    || !"GMAIL".equals(connection.provider())
                    || !"OAUTH2".equals(connection.authType())) {
                throw connectionConfigurationFailure();
            }
            Map<String, String> auth = connection.auth();
            if (!auth.keySet().equals(ACCESS_TOKEN_FIELDS)) {
                throw connectionConfigurationFailure();
            }
            String token = auth.get("accessToken");
            if (token == null || token.isBlank() || token.length() > MAX_ACCESS_TOKEN_LENGTH
                    || token.codePoints().anyMatch(Character::isISOControl)) {
                throw connectionConfigurationFailure();
            }
            return token;
        } catch (NodeExecutor.Failure failure) {
            throw failure;
        } catch (RuntimeException exception) {
            throw connectionConfigurationFailure();
        }
    }

    private Map<String, Object> sentMessage(PinnedHttpTransport.HttpResponse response) {
        if (response == null) {
            throw unknownOutcome();
        }
        int status = response.status();
        if (status >= 200 && status < 300) {
            if (!(response.data() instanceof Map<?, ?> map) || !(map.get("id") instanceof String messageId)
                    || messageId.isBlank()) {
                throw unknownOutcome();
            }
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("messageId", messageId);
            if (map.get("threadId") instanceof String threadId) {
                result.put("threadId", threadId);
            }
            result.put("status", "SENT");
            return result;
        }
        if (status == 401) {
            throw new NodeExecutor.Failure("AUTHENTICATION_REJECTED",
                    "The Gmail provider rejected the configured credentials.", false);
        }
        if (status == 429) {
            // Google refused the request before sending, so a retry cannot duplicate the email.
            throw new NodeExecutor.Failure("HTTP_RATE_LIMITED",
                    "The Gmail provider rate limited the request.", true, true);
        }
        // Assumption: Google rejects a quota-exceeded send before processing it (same precedent as the 429 above),
        // so a retry cannot duplicate the email.
        if (status == 403 && isRateLimit(response.data())) {
            throw new NodeExecutor.Failure("HTTP_RATE_LIMITED",
                    "The Gmail provider rate limited the request.", true, true);
        }
        if (status == 403) {
            throw new NodeExecutor.Failure("HTTP_BUSINESS_REJECTED",
                    "Gmail refused to send; reconnect the Gmail connection to grant send access.", false);
        }
        if (status >= 300 && status < 400) {
            throw new NodeExecutor.Failure("HTTP_REDIRECT_REJECTED",
                    "The Gmail provider returned a redirect that is not followed.", false);
        }
        if (status >= 400 && status < 500 && status != 408) {
            throw new NodeExecutor.Failure("HTTP_BUSINESS_REJECTED",
                    "The Gmail provider rejected the message.", false);
        }
        throw unknownOutcome();
    }

    private NodeExecutor.Failure unknownOutcome() {
        return new NodeExecutor.Failure("HTTP_DEPENDENCY_UNAVAILABLE",
                "The Gmail request outcome is unknown and is not retried to avoid duplicate emails.", false);
    }

    private NodeExecutor.Failure connectionConfigurationFailure() {
        return new NodeExecutor.Failure("CONNECTION_CONFIGURATION_INVALID",
                "The Gmail connection configuration is invalid.", false);
    }
}
