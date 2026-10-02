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
    private static final int MAX_ACCESS_TOKEN_LENGTH = 16 * 1024;
    // RFC 2047: an encoded word is at most 75 chars; 45 raw bytes -> 60 base64 chars + 12 framing.
    private static final int MAX_ENCODED_WORD_BYTES = 45;
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

    private String accessToken(ResolvedConnection connection) {
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
