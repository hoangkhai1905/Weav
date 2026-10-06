package com.weav.workflow.infrastructure.gmail;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Downloads one Gmail attachment (messages.attachments.get, covered by the gmail.readonly scope). */
@Component
public class GmailAttachmentReader {

    private static final java.util.Set<String> RATE_LIMIT_REASONS =
            java.util.Set.of("rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded");

    private static final java.util.regex.Pattern MESSAGE_ID = java.util.regex.Pattern.compile("[0-9A-Fa-f]{1,32}");
    private static final java.util.regex.Pattern ATTACHMENT_ID = java.util.regex.Pattern.compile("[A-Za-z0-9_-]{1,2048}");

    private final GmailClient client;
    private final PinnedHttpTransport transport;

    public GmailAttachmentReader(GmailClient client, PinnedHttpTransport transport) {
        this.client = Objects.requireNonNull(client, "client must not be null");
        this.transport = Objects.requireNonNull(transport, "transport must not be null");
    }

    /**
     * The decoded bytes of at most {@code maxBytes}. The JSON response carries the file as base64url, so the response
     * cap is 4/3 of {@code maxBytes} plus slack for the envelope. Read-only, so a retryable failure is safe to retry.
     * A bad status or body is a non-retryable failure of this one attachment (the caller skips it); credential,
     * rate-limit and outage failures keep their retryable or credential codes.
     */
    byte[] read(String messageId, String attachmentId, long maxBytes, ResolvedConnection connection) {
        if (!MESSAGE_ID.matcher(messageId).matches() || !ATTACHMENT_ID.matcher(attachmentId).matches()) {
            throw new NodeExecutor.Failure("GMAIL_ATTACHMENT_UNREADABLE", "The Gmail attachment could not be read.", false);
        }
        int cap = (int) Math.min(PinnedHttpTransport.MAX_CALL_BYTES, maxBytes / 3 * 4 + 4 * 1024);
        PinnedHttpTransport.HttpResponse response = transport.executeGmailAttachmentGetWithBearerToken(
                URI.create(GmailClient.MESSAGES_URI + "/" + messageId + "/attachments/" + attachmentId),
                client.accessToken(connection), cap);
        if (response == null) {
            throw new NodeExecutor.Failure("HTTP_DEPENDENCY_UNAVAILABLE", "The Gmail request failed.", true);
        }
        int status = response.status();
        if (status == 401) {
            throw new NodeExecutor.Failure("AUTHENTICATION_REJECTED",
                    "The Gmail provider rejected the configured credentials.", false);
        }
        if (status == 429 || status == 408 || status >= 500) {
            throw new NodeExecutor.Failure(status == 429 ? "HTTP_RATE_LIMITED" : "HTTP_DEPENDENCY_UNAVAILABLE",
                    "The Gmail provider is temporarily unavailable.", true);
        }
        if (status == 403 && isRateLimit(response.data())) {
            throw new NodeExecutor.Failure("HTTP_RATE_LIMITED", "The Gmail provider rate limited the request.", true);
        }
        if (status < 200 || status >= 300 || !(response.data() instanceof Map<?, ?> map)
                || !(map.get("data") instanceof String data)) {
            throw new NodeExecutor.Failure("GMAIL_ATTACHMENT_UNREADABLE", "The Gmail attachment could not be read.", false);
        }
        byte[] bytes = decode(data);
        if (bytes.length > maxBytes) {
            throw new NodeExecutor.Failure("FILE_TOO_LARGE", "The Gmail attachment is larger than allowed.", false);
        }
        return bytes;
    }

    private static boolean isRateLimit(Object data) {
        return data instanceof Map<?, ?> root && root.get("error") instanceof Map<?, ?> error
                && error.get("errors") instanceof List<?> errors
                && errors.stream().anyMatch(item -> item instanceof Map<?, ?> entry
                && entry.get("reason") instanceof String reason && RATE_LIMIT_REASONS.contains(reason));
    }

    /** base64url, with or without padding; anything else is an unreadable attachment, never an exception. */
    static byte[] decode(String data) {
        try {
            return Base64.getUrlDecoder().decode(data);
        } catch (IllegalArgumentException invalid) {
            throw new NodeExecutor.Failure("GMAIL_ATTACHMENT_UNREADABLE", "The Gmail attachment could not be read.", false);
        }
    }
}
