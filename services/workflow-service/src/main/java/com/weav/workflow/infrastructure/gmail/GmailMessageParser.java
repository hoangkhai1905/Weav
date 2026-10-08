package com.weav.workflow.infrastructure.gmail;

import com.weav.workflow.application.port.out.WorkflowFileStore;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Turns a Gmail {@code messages.get?format=full} JSON object into the trigger input of one run. */
public final class GmailMessageParser {

    static final int MAX_BODY_BYTES = 32 * 1024;
    static final int MAX_HTML_CHARS = 256 * 1024;
    private static final java.util.Set<String> BLOCK_TAGS = java.util.Set.of("p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6");
    private static final int MAX_HEADER_CHARS = 2_000;
    private static final int MAX_PART_DEPTH = 20;
    private static final int MAX_PARTS_VISITED = 2_000;
    private static final int MAX_ATTACHMENT_PARTS = 50;
    private static final int MAX_MIME_CHARS = 127;
    private static final Pattern MIME_TYPE = Pattern.compile("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+");
    private static final Pattern ATTACHMENT_ID = Pattern.compile("[A-Za-z0-9_-]{1,2048}");
    private static final Pattern ENCODED_WORD = Pattern.compile("=\\?([^?\\s]+)\\?([bBqQ])\\?([^?\\s]*)\\?=");
    private static final Pattern CHARSET = Pattern.compile("charset\\s*=\\s*\"?([A-Za-z0-9_.:-]+)\"?",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern ENTITY = Pattern.compile("&(#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z]{2,6});");

    private GmailMessageParser() {
    }

    /** {@code attachments}: the attachment parts found (not downloaded); input already lists them as metadata. */
    public record Parsed(String id, Instant internalDate, Map<String, Object> input, List<AttachmentPart> attachments) {
    }

    /** One attachment part: {@code attachmentId} (download it) or {@code inlineData} (base64url, already in the message). */
    record AttachmentPart(String filename, String mimeType, long size, String attachmentId, String inlineData) {
        Map<String, Object> metadata() {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("filename", filename);
            item.put("mimeType", mimeType);
            item.put("size", size);
            return item;
        }
    }

    /** Empty when the message has no usable id or internalDate (it is skipped, never half-admitted). */
    public static Optional<Parsed> parse(Map<?, ?> message) {
        return parse(message, false);
    }

    /** {@code bodyOmitted}: the full message was too large, so only headers and snippet were read. */
    public static Optional<Parsed> parse(Map<?, ?> message, boolean bodyOmitted) {
        if (!(message.get("id") instanceof String id) || id.isBlank()
                || !(message.get("internalDate") instanceof String internal)) {
            return Optional.empty();
        }
        Instant internalDate;
        try {
            internalDate = Instant.ofEpochMilli(Long.parseLong(internal));
        } catch (NumberFormatException | java.time.DateTimeException exception) {
            return Optional.empty();
        }
        Map<?, ?> payload = message.get("payload") instanceof Map<?, ?> map ? map : Map.of();
        Map<String, String> headers = headers(payload);
        Body body = body(payload);
        List<AttachmentPart> attachments = bodyOmitted ? List.of() : attachmentParts(payload);

        Map<String, Object> input = new LinkedHashMap<>();
        input.put("messageId", id);
        input.put("threadId", message.get("threadId") instanceof String thread ? clean(thread) : "");
        String from = header(headers, "from");
        String[] sender = sender(from);
        input.put("from", from);
        input.put("fromEmail", sender[1]);
        input.put("fromName", sender[0]);
        input.put("to", header(headers, "to"));
        input.put("cc", header(headers, "cc"));
        input.put("subject", header(headers, "subject"));
        input.put("date", internalDate.toString());
        input.put("snippet", message.get("snippet") instanceof String snippet ? clean(snippet) : "");
        input.put("body", body.text());
        input.put("bodyTruncated", body.truncated());
        input.put("bodyOmitted", bodyOmitted);
        input.put("labelIds", labels(message.get("labelIds")));
        input.put("attachments", attachments.stream().map(AttachmentPart::metadata).toList());
        return Optional.of(new Parsed(id, internalDate, input, attachments));
    }

    /** {display name or "", bare address} of a From header ({@code addr}, {@code Name <addr>}, {@code "Name" <addr>}). */
    static String[] sender(String from) {
        java.util.regex.Matcher m = GmailNodeExecutor.MAILBOX.matcher(from.trim());
        if (!m.matches()) {
            return new String[] {"", from.trim()};
        }
        String name = m.group(1).trim();
        if (name.length() >= 2 && name.startsWith("\"") && name.endsWith("\"")) {
            name = name.substring(1, name.length() - 1).replaceAll("\\\\(.)", "$1");
        }
        return new String[] {name.trim(), m.group(2).trim()};
    }

    /**
     * Attachment parts of the payload, in message order: parts with a filename and either a {@code body.attachmentId}
     * or inline {@code body.data}. Parts without a filename (inline images) are ignored. Bounded: depth
     * {@link #MAX_PART_DEPTH}, {@link #MAX_PARTS_VISITED} parts looked at, {@link #MAX_ATTACHMENT_PARTS} kept.
     */
    static List<AttachmentPart> attachmentParts(Map<?, ?> payload) {
        List<AttachmentPart> found = new ArrayList<>();
        collectAttachments(payload, 0, new int[1], found);
        return found;
    }

    private static void collectAttachments(Map<?, ?> part, int depth, int[] visited, List<AttachmentPart> found) {
        if (depth > MAX_PART_DEPTH || ++visited[0] > MAX_PARTS_VISITED || found.size() >= MAX_ATTACHMENT_PARTS) {
            return;
        }
        String rawName = part.get("filename") instanceof String name ? clean(name) : "";
        Map<?, ?> body = part.get("body") instanceof Map<?, ?> map ? map : Map.of();
        String attachmentId = body.get("attachmentId") instanceof String id && !id.isEmpty() ? id : null;
        String data = body.get("data") instanceof String text && !text.isEmpty() ? text : null;
        if (!rawName.isBlank() && (attachmentId != null || data != null)) {
            String filename = WorkflowFileStore.safeFilename(rawName);
            String mimeType = part.get("mimeType") instanceof String type ? clean(type).strip() : "";
            long size = attachmentId != null
                    ? (body.get("size") instanceof Number number && number.longValue() > 0 ? number.longValue() : 0)
                    : data.length() * 3L / 4;
            found.add(new AttachmentPart(filename == null ? "attachment" : filename,
                    MIME_TYPE.matcher(mimeType).matches() && mimeType.length() <= MAX_MIME_CHARS
                            ? mimeType : "application/octet-stream",
                    size,
                    attachmentId != null && ATTACHMENT_ID.matcher(attachmentId).matches() ? attachmentId : null,
                    attachmentId == null ? data : null));
        }
        if (part.get("parts") instanceof List<?> children) {
            for (Object child : children) {
                if (child instanceof Map<?, ?> childPart) {
                    collectAttachments(childPart, depth + 1, visited, found);
                }
            }
        }
    }

    private static List<String> labels(Object value) {
        List<String> labels = new ArrayList<>();
        if (value instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof String label) {
                    labels.add(clean(label));
                }
            }
        }
        return labels;
    }

    private static Map<String, String> headers(Map<?, ?> part) {
        Map<String, String> headers = new LinkedHashMap<>();
        if (part.get("headers") instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof Map<?, ?> header && header.get("name") instanceof String name
                        && header.get("value") instanceof String value) {
                    headers.putIfAbsent(name.toLowerCase(Locale.ROOT), value);
                }
            }
        }
        return headers;
    }

    private static String header(Map<String, String> headers, String name) {
        String value = headers.get(name);
        if (value == null) {
            return "";
        }
        String bounded = value.length() > 4 * MAX_HEADER_CHARS ? value.substring(0, 4 * MAX_HEADER_CHARS) : value;
        String decoded = decodeEncodedWords(bounded.replace('\r', ' ').replace('\n', ' ').strip());
        return clean(decoded.length() > MAX_HEADER_CHARS ? decoded.substring(0, MAX_HEADER_CHARS) : decoded);
    }

    /** RFC 2047 encoded words (=?charset?B|Q?text?=); whitespace between adjacent words is dropped. */
    static String decodeEncodedWords(String value) {
        Matcher matcher = ENCODED_WORD.matcher(value);
        StringBuilder out = new StringBuilder();
        int last = 0;
        boolean previousWasWord = false;
        while (matcher.find()) {
            String between = value.substring(last, matcher.start());
            if (!(previousWasWord && between.isBlank())) {
                out.append(between);
            }
            out.append(decodeWord(matcher.group(1), matcher.group(2), matcher.group(3), matcher.group()));
            last = matcher.end();
            previousWasWord = true;
        }
        return out.append(value, last, value.length()).toString();
    }

    private static String decodeWord(String charset, String encoding, String text, String original) {
        try {
            byte[] bytes;
            if ("B".equalsIgnoreCase(encoding)) {
                bytes = Base64.getMimeDecoder().decode(text);
            } else {
                String q = text.replace('_', ' ');
                java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
                for (int i = 0; i < q.length(); i++) {
                    char c = q.charAt(i);
                    if (c == '=' && i + 2 < q.length()) {
                        buffer.write(Integer.parseInt(q.substring(i + 1, i + 3), 16));
                        i += 2;
                    } else {
                        buffer.write(c);
                    }
                }
                bytes = buffer.toByteArray();
            }
            return new String(bytes, charset(charset));
        } catch (RuntimeException exception) {
            return original;
        }
    }

    private static Charset charset(String name) {
        try {
            return Charset.forName(name);
        } catch (RuntimeException exception) {
            return StandardCharsets.UTF_8;
        }
    }

    record Body(String text, boolean truncated) {
    }

    /** First text/plain part (multipart walked depth first); else the first text/html part with tags stripped. */
    static Body body(Map<?, ?> payload) {
        String plain = findText(payload, "text/plain", 0);
        String text = plain;
        if (text == null) {
            String html = findText(payload, "text/html", 0);
            text = html == null ? "" : stripHtml(html);
        }
        return cap(clean(text));
    }

    /**
     * Removes what Postgres JSONB (or JSON itself) cannot store: C0 controls except tab, CR and LF, DEL, and
     * unpaired surrogates. A NUL in one email must never block admission of everything newer.
     */
    static String clean(String text) {
        StringBuilder out = null;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            boolean bad = c < 0x20 && c != '\t' && c != '\n' && c != '\r' || c == 0x7f
                    || Character.isHighSurrogate(c) && !(i + 1 < text.length() && Character.isLowSurrogate(text.charAt(i + 1)))
                    || Character.isLowSurrogate(c) && !(i > 0 && Character.isHighSurrogate(text.charAt(i - 1)));
            if (bad && out == null) {
                out = new StringBuilder(text.length()).append(text, 0, i);
            }
            if (!bad && out != null) {
                out.append(c);
            }
        }
        return out == null ? text : out.toString();
    }

    private static String findText(Map<?, ?> part, String mimeType, int depth) {
        if (depth > MAX_PART_DEPTH) {
            return null;
        }
        String filename = part.get("filename") instanceof String name ? name : "";
        Map<?, ?> body = part.get("body") instanceof Map<?, ?> map ? map : Map.of();
        if (mimeType.equalsIgnoreCase(String.valueOf(part.get("mimeType"))) && filename.isEmpty()
                && body.get("data") instanceof String data && !data.isEmpty()) {
            try {
                byte[] bytes = Base64.getUrlDecoder().decode(data);
                return new String(bytes, charset(partCharset(part)));
            } catch (IllegalArgumentException exception) {
                return null;
            }
        }
        if (part.get("parts") instanceof List<?> children) {
            for (Object child : children) {
                if (child instanceof Map<?, ?> childPart) {
                    String found = findText(childPart, mimeType, depth + 1);
                    if (found != null) {
                        return found;
                    }
                }
            }
        }
        return null;
    }

    private static String partCharset(Map<?, ?> part) {
        String contentType = headers(part).get("content-type");
        if (contentType != null) {
            Matcher matcher = CHARSET.matcher(contentType);
            if (matcher.find()) {
                return matcher.group(1);
            }
        }
        return "UTF-8";
    }

    /** Cuts to {@link #MAX_BODY_BYTES} of UTF-8 on a code point boundary. */
    static Body cap(String text) {
        if (text.getBytes(StandardCharsets.UTF_8).length <= MAX_BODY_BYTES) {
            return new Body(text, false);
        }
        int bytes = 0;
        int end = 0;
        while (end < text.length()) {
            int codePoint = text.codePointAt(end);
            int size = codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
            if (bytes + size > MAX_BODY_BYTES) {
                break;
            }
            bytes += size;
            end += Character.charCount(codePoint);
        }
        return new Body(text.substring(0, end), true);
    }

    /**
     * Single forward pass (no regex, no re-scan), so hostile input such as 500k "<" or 50k unclosed "<script"
     * stays linear. Input is cut to {@link #MAX_HTML_CHARS} first. ponytail: a readable approximation of
     * HTML-to-text, not an HTML parser; the result is plain text input for later nodes, never rendered.
     */
    static String stripHtml(String html) {
        int limit = MAX_HTML_CHARS;
        if (html.length() > limit && Character.isHighSurrogate(html.charAt(limit - 1))) {
            limit--; // never cut a surrogate pair in half
        }
        String input = html.length() > limit ? html.substring(0, limit) : html;
        int n = input.length();
        StringBuilder out = new StringBuilder(Math.min(n, 4096));
        int i = 0;
        while (i < n) {
            char c = input.charAt(i);
            if (c != '<' || i + 1 >= n || !(Character.isLetter(input.charAt(i + 1))
                    || input.charAt(i + 1) == '/' || input.charAt(i + 1) == '!' || input.charAt(i + 1) == '?')) {
                out.append(c); // plain text, including a "<" that does not start a tag
                i++;
                continue;
            }
            boolean closing = input.charAt(i + 1) == '/';
            int nameStart = closing ? i + 2 : i + 1;
            int nameEnd = nameStart;
            while (nameEnd < n && Character.isLetterOrDigit(input.charAt(nameEnd))) {
                nameEnd++;
            }
            String name = input.substring(nameStart, nameEnd).toLowerCase(Locale.ROOT);
            int tagEnd = nameEnd;
            while (tagEnd < n && input.charAt(tagEnd) != '>') {
                tagEnd++;
            }
            i = Math.min(n, tagEnd + 1);
            if (!closing && (name.equals("script") || name.equals("style") || name.equals("head"))) {
                i = skipElement(input, i, name);
            } else if (name.equals("br") || closing && BLOCK_TAGS.contains(name)) {
                out.append('\n');
            }
        }
        return normalizeWhitespace(decodeEntities(out.toString()).replace('\u00a0', ' '));
    }

    /** Index just after the matching close tag, or the end of input when it never closes. */
    private static int skipElement(String input, int from, String name) {
        int n = input.length();
        int i = from;
        while (i < n) {
            if (input.charAt(i) == '<' && i + 1 < n && input.charAt(i + 1) == '/'
                    && input.regionMatches(true, i + 2, name, 0, name.length())) {
                int end = i + 2 + name.length();
                while (end < n && input.charAt(end) != '>') {
                    end++;
                }
                return Math.min(n, end + 1);
            }
            i++;
        }
        return n;
    }

    /** Collapses blanks to one space and blank lines to at most one empty line, in one pass. */
    private static String normalizeWhitespace(String text) {
        StringBuilder out = new StringBuilder(text.length());
        boolean pendingSpace = false;
        int newlines = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '\n') {
                newlines++;
            } else if (Character.isWhitespace(c)) {
                pendingSpace = true;
            } else {
                if (out.length() > 0) {
                    out.append(newlines >= 2 ? "\n\n" : newlines == 1 ? "\n" : pendingSpace ? " " : "");
                }
                newlines = 0;
                pendingSpace = false;
                out.append(c);
            }
        }
        return out.toString();
    }

    private static String decodeEntities(String text) {
        Matcher matcher = ENTITY.matcher(text);
        StringBuilder out = new StringBuilder();
        while (matcher.find()) {
            String entity = matcher.group(1);
            String replacement = switch (entity) {
                case "amp" -> "&";
                case "lt" -> "<";
                case "gt" -> ">";
                case "quot" -> "\"";
                case "apos" -> "'";
                case "nbsp" -> " ";
                default -> numeric(entity);
            };
            matcher.appendReplacement(out, Matcher.quoteReplacement(replacement == null ? matcher.group() : replacement));
        }
        return matcher.appendTail(out).toString();
    }

    private static String numeric(String entity) {
        if (entity.charAt(0) != '#') {
            return null;
        }
        try {
            int codePoint = entity.length() > 1 && (entity.charAt(1) == 'x' || entity.charAt(1) == 'X')
                    ? Integer.parseInt(entity.substring(2), 16) : Integer.parseInt(entity.substring(1));
            // Control characters and surrogates decode to nothing (they cannot be stored); invalid code points stay as text.
            return Character.isValidCodePoint(codePoint) ? clean(new String(Character.toChars(codePoint))) : null;
        } catch (NumberFormatException exception) {
            return null;
        }
    }
}
