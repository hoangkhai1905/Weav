package com.weav.workflow.infrastructure.gmail;

import org.junit.jupiter.api.Test;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GmailMessageParserTest {

    private static String b64(String text, Charset charset) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(text.getBytes(charset));
    }

    private static Map<String, Object> part(String mime, String text) {
        return Map.of("mimeType", mime, "filename", "", "body", Map.of("size", text.length(),
                "data", b64(text, StandardCharsets.UTF_8)));
    }

    private static Map<String, Object> message(Map<String, Object> payload) {
        return Map.of("id", "18c0ffee00000001", "threadId", "18c0ffee00000000", "labelIds", List.of("INBOX", "UNREAD"),
                "snippet", "Hi there", "internalDate", "1790000000123", "payload", payload);
    }

    private static Map<String, Object> headers(Map<String, Object> payload, String... pairs) {
        java.util.List<Map<String, String>> list = new java.util.ArrayList<>();
        for (int i = 0; i < pairs.length; i += 2) {
            list.add(Map.of("name", pairs[i], "value", pairs[i + 1]));
        }
        java.util.Map<String, Object> copy = new java.util.LinkedHashMap<>(payload);
        copy.put("headers", list);
        return copy;
    }

    @Test
    void plainTextMessageProducesTheDocumentedInput() {
        Map<String, Object> payload = headers(part("text/plain", "Hello\nworld"),
                "From", "Ada <ada@example.test>", "to", "me@example.test", "CC", "bob@example.test",
                "Subject", "Weekly report");

        var parsed = GmailMessageParser.parse(message(payload)).orElseThrow();

        assertEquals("18c0ffee00000001", parsed.id());
        assertEquals(Instant.ofEpochMilli(1790000000123L), parsed.internalDate());
        assertEquals(List.of("messageId", "threadId", "from", "to", "cc", "subject", "date", "snippet", "body",
                "bodyTruncated", "bodyOmitted", "labelIds"), List.copyOf(parsed.input().keySet()));
        assertEquals("Ada <ada@example.test>", parsed.input().get("from"));
        assertEquals("me@example.test", parsed.input().get("to"));
        assertEquals("bob@example.test", parsed.input().get("cc"));
        assertEquals("Weekly report", parsed.input().get("subject"));
        assertEquals("2026-09-21T14:13:20.123Z", parsed.input().get("date"));
        assertEquals("Hi there", parsed.input().get("snippet"));
        assertEquals("Hello\nworld", parsed.input().get("body"));
        assertEquals(false, parsed.input().get("bodyTruncated"));
        assertEquals(false, parsed.input().get("bodyOmitted"), "always present so mappings never miss the path");
        assertEquals(List.of("INBOX", "UNREAD"), parsed.input().get("labelIds"));
    }

    @Test
    void missingHeadersBecomeEmptyStringsAndMissingIdOrDateSkipsTheMessage() {
        var parsed = GmailMessageParser.parse(message(part("text/plain", "x"))).orElseThrow();
        assertEquals("", parsed.input().get("cc"));
        assertEquals("", parsed.input().get("subject"));

        assertTrue(GmailMessageParser.parse(Map.of("id", "a1", "payload", Map.of())).isEmpty());
        assertTrue(GmailMessageParser.parse(Map.of("internalDate", "1", "payload", Map.of())).isEmpty());
        assertTrue(GmailMessageParser.parse(Map.of("id", "a1", "internalDate", "not-a-number")).isEmpty());
    }

    @Test
    void multipartPrefersTextPlainOverHtmlAndIgnoresAttachments() {
        Map<String, Object> attachment = Map.of("mimeType", "text/plain", "filename", "notes.txt",
                "body", Map.of("attachmentId", "att-1", "data", b64("attachment text", StandardCharsets.UTF_8)));
        Map<String, Object> alternative = Map.of("mimeType", "multipart/alternative",
                "parts", List.of(part("text/html", "<p>html body</p>"), part("text/plain", "plain body")));
        Map<String, Object> payload = Map.of("mimeType", "multipart/mixed", "parts", List.of(attachment, alternative));

        var body = GmailMessageParser.body(payload);

        assertEquals("plain body", body.text());
        assertFalse(body.truncated());
    }

    @Test
    void htmlOnlyMessageFallsBackToStrippedTextWithEntitiesDecoded() {
        String html = "<html><head><style>p{color:red}</style></head><body><p>Total: 5 &lt; 7 &amp; done</p>"
                + "<script>alert(1)</script><div>Line&nbsp;two<br>Line three &#233; &#x1F600;</div></body></html>";

        var body = GmailMessageParser.body(Map.of("mimeType", "multipart/alternative",
                "parts", List.of(part("text/html", html))));

        assertEquals("Total: 5 < 7 & done\nLine two\nLine three é 😀", body.text());
    }

    @Test
    void controlCharactersNulAndLoneSurrogatesNeverReachTheInput() {
        String nul = String.valueOf((char) 0);
        Map<String, Object> payload = headers(part("text/plain", "a" + nul + "b\u0001c\u007fd\te\nf\rg"),
                "Subject", "Hi" + nul + "there", "From", "x\uD800y");
        Map<String, Object> message = new java.util.LinkedHashMap<>(message(payload));
        message.put("snippet", "snip" + nul + "pet");
        message.put("labelIds", List.of("IN" + nul + "BOX"));

        var input = GmailMessageParser.parse(message).orElseThrow().input();

        assertEquals("abcd\te\nf\rg", input.get("body"));
        assertEquals("Hithere", input.get("subject"));
        assertEquals("xy", input.get("from"));
        assertEquals("snippet", input.get("snippet"));
        assertEquals(List.of("INBOX"), input.get("labelIds"));

        var html = GmailMessageParser.body(Map.of("mimeType", "text/html", "filename", "",
                "body", Map.of("data", b64("<p>a&#0;b&#x0;c&#1;d&#xD800;e&#233;</p>", StandardCharsets.UTF_8))));
        assertEquals("abcde\u00e9", html.text());
    }

    @Test
    void theHtmlCutNeverSplitsASurrogatePair() {
        String html = "x".repeat(GmailMessageParser.MAX_HTML_CHARS - 1) + "\uD83D\uDE00 tail";

        String text = GmailMessageParser.stripHtml(html);

        assertEquals(GmailMessageParser.MAX_HTML_CHARS - 1, text.length());
        assertFalse(Character.isHighSurrogate(text.charAt(text.length() - 1)));
    }

    @Test
    void metadataOnlyReadsAreMarkedBodyOmitted() {
        var parsed = GmailMessageParser.parse(message(headers(Map.of("mimeType", "multipart/mixed"), "Subject", "Big")), true)
                .orElseThrow();

        assertEquals(true, parsed.input().get("bodyOmitted"));
        assertEquals("", parsed.input().get("body"));
        assertEquals("Big", parsed.input().get("subject"));
    }

    @Test
    void hostileHtmlIsStrippedInLinearTime() {
        String manyOpen = "<".repeat(500_000);
        String unclosedScripts = "<script".repeat(50_000);
        String unclosedTags = "<a ".repeat(100_000) + "text";
        String spaces = "x" + " ".repeat(200_000) + "y";
        org.junit.jupiter.api.Assertions.assertTimeoutPreemptively(java.time.Duration.ofSeconds(2), () -> {
            assertEquals(GmailMessageParser.MAX_HTML_CHARS, GmailMessageParser.stripHtml(manyOpen).length());
            assertEquals("", GmailMessageParser.stripHtml(unclosedScripts));
            assertEquals("", GmailMessageParser.stripHtml(unclosedTags));
            assertEquals("x y", GmailMessageParser.stripHtml(spaces));
        });
    }

    @Test
    void partCharsetIsHonouredAndDefaultsToUtf8() {
        Map<String, Object> latin = headers(Map.of("mimeType", "text/plain", "filename", "",
                "body", Map.of("data", b64("café", Charset.forName("ISO-8859-1")))),
                "Content-Type", "text/plain; charset=\"ISO-8859-1\"");
        assertEquals("café", GmailMessageParser.body(latin).text());

        Map<String, Object> unknown = headers(part("text/plain", "café"), "Content-Type", "text/plain; charset=nope-9");
        assertEquals("café", GmailMessageParser.body(unknown).text());
        assertEquals("café", GmailMessageParser.body(part("text/plain", "café")).text());
    }

    @Test
    void bodyIsCappedAt32KiBOnACodePointBoundary() {
        String emoji = "😀"; // 4 bytes in UTF-8
        String text = "a" + emoji.repeat(10_000);

        var body = GmailMessageParser.body(part("text/plain", text));

        assertTrue(body.truncated());
        byte[] bytes = body.text().getBytes(StandardCharsets.UTF_8);
        assertEquals(1 + 4 * 8191, bytes.length, "1 + 8191 emoji = 32765 bytes; the next emoji would cross 32768");
        assertTrue(bytes.length <= GmailMessageParser.MAX_BODY_BYTES);
        assertTrue(body.text().endsWith(emoji), "never cut inside a surrogate pair");

        var exact = GmailMessageParser.body(part("text/plain", "b".repeat(GmailMessageParser.MAX_BODY_BYTES)));
        assertFalse(exact.truncated());
    }

    @Test
    void subjectEncodedWordsAreDecoded() {
        assertEquals("Báo cáo tuần",
                GmailMessageParser.decodeEncodedWords("=?UTF-8?B?QsOhbyBjw6FvIHR14bqnbg==?="));
        assertEquals("café menu",
                GmailMessageParser.decodeEncodedWords("=?UTF-8?Q?caf=C3=A9_menu?="));
        assertEquals("ab", GmailMessageParser.decodeEncodedWords("=?UTF-8?Q?a?= =?UTF-8?Q?b?="));
        assertEquals("plain =?broken", GmailMessageParser.decodeEncodedWords("plain =?broken"));
    }
}
