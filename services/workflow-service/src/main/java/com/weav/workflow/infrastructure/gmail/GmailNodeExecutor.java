package com.weav.workflow.infrastructure.gmail;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ConnectionReconnectRequiredException;
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
    private static final int MAX_SENDER_NAME_LENGTH = 100;
    private static final Pattern MESSAGE_ID = Pattern.compile("[0-9A-Fa-f]{1,32}");
    // ponytail: pragmatic address shape check; Gmail performs full RFC 5322 validation.
    static final Pattern ADDRESS = Pattern.compile("[^@\\s,;<>\"()\\[\\]]+@[^@\\s,;<>\"()\\[\\]]+\\.[^@\\s,;<>\"()\\[\\]]+");

    /** {@code Name <addr>} or {@code "Quoted Name" <addr>}: group 2 is the address. */
    static final Pattern MAILBOX = Pattern.compile("(?s)(\"(?:[^\"\\\\]|\\\\.)*\"|[^<>\"]*)\\s*<([^<>]*)>");

    private final GmailClient gmailClient;
    private final WorkspaceConnectionPort workspaceConnections;

    private final EmailAttachmentResolver attachmentResolver;

    public GmailNodeExecutor(GmailClient gmailClient, WorkspaceConnectionPort workspaceConnections,
                             EmailAttachmentResolver attachmentResolver) {
        this.gmailClient = Objects.requireNonNull(gmailClient, "gmailClient must not be null");
        this.workspaceConnections = Objects.requireNonNull(
                workspaceConnections, "workspaceConnections must not be null");
        this.attachmentResolver = Objects.requireNonNull(attachmentResolver, "attachmentResolver must not be null");
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
            // The connection is checked first so a bad one fails without downloads; nothing is sent yet here.
            EmailAttachmentResolver.Resolved attachments =
                    attachmentResolver.resolve(context.workspaceId(), request.attachments());
            Map<String, Object> providerOutput;
            try {
                providerOutput = request.isPlain() && attachments.attachments().isEmpty()
                        ? gmailClient.send(request.recipients(), request.subject(), request.body(), connection)
                        : gmailClient.sendMessage(new GmailClient.Outgoing(request.recipients(), request.cc(),
                        request.bcc(), request.replyTo(), request.senderName(), request.subject(), request.body(),
                        request.html(), request.replyToMessageId(), attachments.attachments()), connection);
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
            if (EmailAttachmentResolver.configured(request.attachments())) {
                jsonOutput.put("attachmentCount", attachments.attachments().size());
                if (attachments.skipped() > 0) {
                    jsonOutput.put("skippedAttachments", attachments.skipped());
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
        List<String> recipients = parseRecipients("to", config.get("to"));
        List<String> cc = parseOptionalRecipients("cc", config.get("cc"));
        List<String> bcc = parseOptionalRecipients("bcc", config.get("bcc"));
        List<String> replyTo = parseOptionalRecipients("replyTo", config.get("replyTo"));
        if (recipients.size() + cc.size() + bcc.size() > MAX_RECIPIENTS) {
            throw NodeExecutor.Failure.invalidField("to", "has too many recipients (to, cc and bcc together).");
        }
        String replyToMessageId = optionalText("replyToMessageId", config.get("replyToMessageId"));
        if (replyToMessageId != null && !MESSAGE_ID.matcher(replyToMessageId).matches()) {
            throw NodeExecutor.Failure.invalidField("replyToMessageId", "is not a valid message id.");
        }
        String senderName = optionalText("senderName", config.get("senderName"));
        if (senderName != null && (senderName.length() > MAX_SENDER_NAME_LENGTH
                || senderName.codePoints().anyMatch(Character::isISOControl))) {
            throw NodeExecutor.Failure.invalidField("senderName", "is too long or contains control characters.");
        }
        boolean html = false;
        if (optionalText("bodyType", config.get("bodyType")) instanceof String type) {
            html = switch (type.toLowerCase(java.util.Locale.ROOT)) {
                case "text" -> false;
                case "html" -> true;
                default -> throw NodeExecutor.Failure.invalidField("bodyType", "must be 'text' or 'html'.");
            };
        }
        String subject = config.get("subject") instanceof String text ? text : null;
        // A blank subject is allowed only when replying: it then becomes "Re: <original subject>".
        if (subject == null || subject.isBlank() && replyToMessageId == null || subject.length() > MAX_SUBJECT_LENGTH
                || subject.codePoints().anyMatch(Character::isISOControl)) {
            throw NodeExecutor.Failure.invalidField("subject", "is empty, too long or contains control characters.");
        }
        Object rawBody = config.getOrDefault("body", "");
        if (!(rawBody instanceof String body) || body.length() > MAX_BODY_LENGTH
                || body.codePoints().anyMatch(c -> Character.isISOControl(c) && c != '\n' && c != '\r' && c != '\t')) {
            throw NodeExecutor.Failure.invalidField("body", "is too long or contains control characters.");
        }
        return new Request(connectionId, recipients, subject, body, cc, bcc, replyTo, senderName, html,
                replyToMessageId, config.get("attachments"));
    }

    /** Absent, null, blank text or an empty list all mean "not set". */
    private static List<String> parseOptionalRecipients(String field, Object value) {
        if (value == null || value instanceof String text && text.isBlank() || value instanceof List<?> list && list.isEmpty()) {
            return List.of();
        }
        return parseRecipients(field, value);
    }

    private static String optionalText(String field, Object value) {
        if (value == null) {
            return null;
        }
        if (!(value instanceof String text)) {
            throw NodeExecutor.Failure.invalidField(field, "must be text.");
        }
        return text.isBlank() ? null : text.strip();
    }

    /**
     * Accepts bare addresses and RFC 5322 mailboxes ({@code Name <addr>}, {@code "Name" <addr>}), as a list or a
     * comma separated string. Only the bare address is kept: the display name is dropped, so no header needs
     * encoding and nothing user-supplied but the validated address reaches the MIME headers.
     */
    static List<String> parseRecipients(String field, Object value) {
        List<Object> candidates = new ArrayList<>();
        if (value instanceof String text) {
            candidates.addAll(splitMailboxes(text));
        } else if (value instanceof List<?> list) {
            candidates.addAll(list.stream().limit(MAX_RECIPIENTS + 1L).toList());
        } else {
            throw NodeExecutor.Failure.invalidField(field, "must be an email address or a list of addresses.");
        }
        List<String> recipients = new ArrayList<>();
        for (Object candidate : candidates) {
            if (!(candidate instanceof String raw)) {
                throw NodeExecutor.Failure.invalidField(field, "is not a valid email address.");
            }
            String mailbox = raw.trim();
            if (mailbox.length() > MAX_ADDRESS_LENGTH * 2 || mailbox.codePoints().anyMatch(Character::isISOControl)) {
                throw NodeExecutor.Failure.invalidField(field, "is not a valid email address.");
            }
            java.util.regex.Matcher named = MAILBOX.matcher(mailbox);
            String address = named.matches() ? named.group(2).trim() : mailbox;
            if (address.isEmpty() || address.length() > MAX_ADDRESS_LENGTH || !ADDRESS.matcher(address).matches()) {
                throw NodeExecutor.Failure.invalidField(field, "is not a valid email address.");
            }
            recipients.add(address);
            if (recipients.size() > MAX_RECIPIENTS) {
                break; // rejected below; no need to validate the rest
            }
        }
        if (recipients.isEmpty() || recipients.size() > MAX_RECIPIENTS) {
            throw NodeExecutor.Failure.invalidField(field, "must have between 1 and " + MAX_RECIPIENTS + " addresses.");
        }
        return List.copyOf(recipients);
    }

    /** Splits on commas that are outside double quotes and angle brackets (so {@code "Doe, J" <a@b.c>} survives). */
    private static List<String> splitMailboxes(String text) {
        List<String> parts = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean quoted = false;
        boolean angle = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (quoted && c == '\\' && i + 1 < text.length()) {
                current.append(c).append(text.charAt(++i));
                continue;
            }
            if (c == '"') {
                quoted = !quoted;
            } else if (!quoted && c == '<') {
                angle = true;
            } else if (!quoted && c == '>') {
                angle = false;
            } else if (c == ',' && !quoted && !angle) {
                parts.add(current.toString());
                current.setLength(0);
                if (parts.size() > MAX_RECIPIENTS) {
                    return parts; // more than allowed: the caller rejects it
                }
                continue;
            }
            current.append(c);
        }
        parts.add(current.toString());
        return parts;
    }

    private UUID parseConnectionId(Object value) {
        if (!(value instanceof String text) || text.length() != 36) {
            throw NodeExecutor.Failure.invalidField("connectionId", "must reference a Gmail connection.");
        }
        try {
            UUID connectionId = UUID.fromString(text);
            if (!connectionId.toString().equalsIgnoreCase(text)) {
                throw new IllegalArgumentException();
            }
            return connectionId;
        } catch (IllegalArgumentException exception) {
            throw NodeExecutor.Failure.invalidField("connectionId", "must reference a Gmail connection.");
        }
    }

    private ResolvedConnection resolveConnection(Context context, UUID connectionId) {
        try {
            return workspaceConnections.resolve(context.workspaceId(), connectionId);
        } catch (ForbiddenException exception) {
            throw new NodeExecutor.Failure("CONNECTION_FORBIDDEN",
                    "The Gmail connection is not available to this workspace.", false);
        } catch (ConnectionReconnectRequiredException exception) {
            throw new NodeExecutor.Failure(ConnectionReconnectRequiredException.CODE,
                    "The Gmail connection must be reconnected: open Connections and reconnect it.", false);
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

    private record Request(UUID connectionId, List<String> recipients, String subject, String body,
                           List<String> cc, List<String> bcc, List<String> replyTo, String senderName, boolean html,
                           String replyToMessageId, Object attachments) {
        /** No optional field is set: the message is exactly what the node sent before they existed. */
        boolean isPlain() {
            return cc.isEmpty() && bcc.isEmpty() && replyTo.isEmpty() && senderName == null && !html
                    && replyToMessageId == null;
        }
    }
}
