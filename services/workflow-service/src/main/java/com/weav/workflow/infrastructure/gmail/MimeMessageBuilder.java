package com.weav.workflow.infrastructure.gmail;

import com.weav.workflow.application.node.NodeExecutor;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Builds the RFC 5322 message sent through Gmail: a single base64 text or HTML part, or multipart/mixed when there
 * are attachments. Every header value is checked for control characters here as a second line of defence; callers
 * validate configuration first.
 */
final class MimeMessageBuilder {

    private static final byte[] CRLF = {'\r', '\n'};
    private static final Base64.Encoder MIME_BASE64 = Base64.getMimeEncoder(76, CRLF);
    private static final Pattern MEDIA_TYPE = Pattern.compile("[A-Za-z0-9!#$&^_.+-]{1,127}/[A-Za-z0-9!#$&^_.+-]{1,127}");
    private static final Pattern MESSAGE_IDS = Pattern.compile("(<[\\x21-\\x7e&&[^<>]]{1,255}>\\s*)+");
    /** Source characters per RFC 2231 continuation segment (each is at most 9 encoded characters). */
    private static final int PARAMETER_SEGMENT_CHARS = 8;

    record Attachment(String filename, String mimeType, byte[] bytes) {
    }

    /**
     * @param fromName   display name, or null to leave From to Gmail
     * @param inReplyTo  Message-ID of the replied-to message in angle brackets, or null
     * @param references space separated Message-IDs, or null
     */
    record Spec(String fromName, String fromAddress, List<String> to, List<String> cc, List<String> bcc,
                List<String> replyTo, String subject, String body, boolean html, String inReplyTo,
                String references, List<Attachment> attachments) {
    }

    private MimeMessageBuilder() {
    }

    static byte[] build(Spec spec) {
        StringBuilder head = new StringBuilder();
        if (spec.fromAddress() != null) {
            String address = header(spec.fromAddress());
            head.append("From: ")
                    .append(spec.fromName() == null ? address
                            : GmailClient.encodeHeaderWords(header(spec.fromName())) + " <" + address + ">")
                    .append("\r\n");
        }
        head.append("To: ").append(addresses(spec.to())).append("\r\n");
        if (!spec.cc().isEmpty()) {
            head.append("Cc: ").append(addresses(spec.cc())).append("\r\n");
        }
        if (!spec.bcc().isEmpty()) {
            head.append("Bcc: ").append(addresses(spec.bcc())).append("\r\n");
        }
        if (!spec.replyTo().isEmpty()) {
            head.append("Reply-To: ").append(addresses(spec.replyTo())).append("\r\n");
        }
        head.append("Subject: ").append(GmailClient.encodeHeaderWords(header(spec.subject()))).append("\r\n");
        if (spec.inReplyTo() != null && MESSAGE_IDS.matcher(spec.inReplyTo()).matches()) {
            head.append("In-Reply-To: ").append(header(spec.inReplyTo().strip())).append("\r\n");
        }
        if (spec.references() != null && MESSAGE_IDS.matcher(spec.references()).matches()) {
            head.append("References: ").append(header(spec.references().strip())).append("\r\n");
        }
        head.append("MIME-Version: 1.0\r\n");

        // Sized up front so the buffer is not regrown (and copied) while attachments are appended.
        long estimate = head.length() + spec.body().length() * 2L + 2048;
        for (Attachment attachment : spec.attachments()) {
            estimate += attachment.bytes().length / 57 * 78L + 78 + 1024;
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.min(estimate, Integer.MAX_VALUE - 16));
        String textPart = (spec.html() ? "Content-Type: text/html; charset=UTF-8\r\n"
                : "Content-Type: text/plain; charset=UTF-8\r\n")
                + "Content-Transfer-Encoding: base64\r\n\r\n"
                + MIME_BASE64.encodeToString(spec.body().getBytes(StandardCharsets.UTF_8)) + "\r\n";
        if (spec.attachments().isEmpty()) {
            write(out, head + textPart);
            return out.toByteArray();
        }
        // Base64 text never contains '_', so a boundary with one cannot occur in any part body.
        String boundary = "weav_" + UUID.randomUUID().toString().replace("-", "");
        write(out, head + "Content-Type: multipart/mixed; boundary=\"" + boundary + "\"\r\n\r\n"
                + "--" + boundary + "\r\n" + textPart);
        for (Attachment attachment : spec.attachments()) {
            String type = MEDIA_TYPE.matcher(attachment.mimeType()).matches()
                    ? attachment.mimeType() : "application/octet-stream";
            write(out, "--" + boundary + "\r\n"
                    + "Content-Type: " + type + ";" + parameter("name", attachment.filename()) + "\r\n"
                    + "Content-Disposition: attachment;" + parameter("filename", attachment.filename()) + "\r\n"
                    + "Content-Transfer-Encoding: base64\r\n\r\n");
            if (attachment.bytes().length > 0) {
                // Encoded straight into the message: no intermediate String or byte[] of the whole attachment.
                try (java.io.OutputStream encoder = MIME_BASE64.wrap(out)) {
                    encoder.write(attachment.bytes());
                } catch (java.io.IOException exception) {
                    throw new java.io.UncheckedIOException(exception);
                }
                write(out, "\r\n");
            }
        }
        write(out, "--" + boundary + "--\r\n");
        return out.toByteArray();
    }

    /**
     * A MIME parameter as a folded continuation line: a quoted ASCII value when it is plain, otherwise RFC 2231
     * {@code name*0*=UTF-8''...} segments (percent-encoded, one per line).
     */
    static String parameter(String name, String value) {
        header(value);
        if (value.length() <= 60 && value.chars().allMatch(c -> c >= 0x20 && c < 0x7f && c != '"' && c != '\\')) {
            return " " + name + "=\"" + value + "\"";
        }
        StringBuilder out = new StringBuilder();
        int segment = 0;
        int index = 0;
        while (index < value.length()) {
            StringBuilder part = new StringBuilder();
            for (int chars = 0; index < value.length() && chars < PARAMETER_SEGMENT_CHARS; chars++) {
                int codePoint = value.codePointAt(index);
                index += Character.charCount(codePoint);
                for (byte b : new String(Character.toChars(codePoint)).getBytes(StandardCharsets.UTF_8)) {
                    int unsigned = b & 0xff;
                    if (unsigned < 0x80 && (Character.isLetterOrDigit(unsigned) || "!#$&+-.^_`|~".indexOf(unsigned) >= 0)) {
                        part.append((char) unsigned);
                    } else {
                        part.append('%').append(String.format("%02X", unsigned));
                    }
                }
            }
            out.append(segment == 0 ? "" : ";\r\n ").append(segment == 0 ? " " : "")
                    .append(name).append('*').append(segment).append("*=")
                    .append(segment == 0 ? "UTF-8''" : "").append(part);
            segment++;
        }
        return out.toString();
    }

    private static String addresses(List<String> list) {
        return String.join(", ", list.stream().map(MimeMessageBuilder::header).toList());
    }

    /** Rejects CR, LF and any other control character in a header value. */
    private static String header(String value) {
        if (value == null || value.codePoints().anyMatch(Character::isISOControl)) {
            throw new NodeExecutor.Failure("CONFIGURATION_ERROR", "The email node configuration is invalid.", false);
        }
        return value;
    }

    private static void write(ByteArrayOutputStream out, String text) {
        out.writeBytes(text.getBytes(StandardCharsets.UTF_8));
    }
}
