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
        assertEquals(List.of("messageId", "threadId", "from", "fromEmail", "fromName", "to", "cc", "subject", "date", "snippet", "body",
                "bodyTruncated", "bodyOmitted", "labelIds", "attachments"), List.copyOf(parsed.input().keySet()));
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

    // ---- attachments ----

    private static Map<String, Object> file(String filename, String mime, Map<String, Object> body) {
        return Map.of("mimeType", mime, "filename", filename, "body", body);
    }

    private static Map<String, Object> multipart(String mime, List<Object> parts) {
        return Map.of("mimeType", mime, "filename", "", "parts", parts);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> listed(Map<String, Object> payload) {
        return (List<Map<String, Object>>) GmailMessageParser.parse(message(payload)).orElseThrow()
                .input().get("attachments");
    }

    @Test
    void nestedAttachmentPartsAreCollectedInMessageOrderAndInlineImagesWithoutAFilenameAreIgnored() {
        Map<String, Object> payload = multipart("multipart/mixed", List.of(
                multipart("multipart/related", List.of(
                        multipart("multipart/alternative", List.of(part("text/plain", "hi"), part("text/html", "<p>hi</p>"))),
                        file("", "image/png", Map.of("attachmentId", "CID1", "size", 10)),
                        file("logo.png", "image/png", Map.of("attachmentId", "ATT1", "size", 2048)))),
                file("report.pdf", "application/pdf", Map.of("attachmentId", "ATT2", "size", 4096))));

        var parsed = GmailMessageParser.parse(message(payload)).orElseThrow();

        assertEquals(List.of(
                Map.of("filename", "logo.png", "mimeType", "image/png", "size", 2048L),
                Map.of("filename", "report.pdf", "mimeType", "application/pdf", "size", 4096L)),
                parsed.input().get("attachments"));
        assertEquals(List.of("ATT1", "ATT2"), parsed.attachments().stream()
                .map(GmailMessageParser.AttachmentPart::attachmentId).toList());
        assertEquals("hi", parsed.input().get("body"));
    }

    @Test
    void anAttachmentIdIsDownloadedButSmallInlineDataStaysInTheMessage() {
        Map<String, Object> payload = multipart("multipart/mixed", List.of(
                file("a.txt", "text/plain", Map.of("attachmentId", "ATT1", "size", 5)),
                file("b.txt", "text/plain", Map.of("data", b64("hello", StandardCharsets.UTF_8), "size", 5)),
                file("c.txt", "text/plain", Map.of("size", 5)),
                file("d.txt", "text/plain", Map.of("data", ""))));

        var parts = GmailMessageParser.parse(message(payload)).orElseThrow().attachments();

        assertEquals(2, parts.size(), "a part with neither attachmentId nor data is not an attachment");
        assertEquals("ATT1", parts.get(0).attachmentId());
        assertEquals(null, parts.get(0).inlineData());
        assertEquals(null, parts.get(1).attachmentId());
        assertEquals(b64("hello", StandardCharsets.UTF_8), parts.get(1).inlineData());
        assertEquals(5L, parts.get(1).size());
    }

    @Test
    void filenamesAndMimeTypesAreSanitizedAndNeverCarryControlCharacters() {
        Map<String, Object> payload = multipart("multipart/mixed", List.of(
                file("evil\u0000..\\..\\/name‮.pdf\u0007", "application/pdf\r\nX: y", Map.of("attachmentId", "A1", "size", 1)),
                file("\u0000\u0001", "text/plain", Map.of("attachmentId", "A2", "size", 1)),
                file("...", "x".repeat(500) + "/y", Map.of("attachmentId", "A3", "size", 1)),
                file("ok.txt", "text/plain", Map.of("attachmentId", "bad id/../x", "size", 1))));

        List<Map<String, Object>> list = listed(payload);

        assertEquals(3, list.size(), "a filename that is only control characters is not a filename");
        assertEquals("evil....name.pdf", list.get(0).get("filename"));
        assertEquals("application/octet-stream", list.get(0).get("mimeType"));
        assertEquals("attachment", list.get(1).get("filename"), "only dots falls back");
        assertEquals("application/octet-stream", list.get(1).get("mimeType"));
        assertEquals("ok.txt", list.get(2).get("filename"));
        for (Map<String, Object> item : list) {
            assertFalse(item.toString().chars().anyMatch(c -> c < 0x20 && c != ' '), item.toString());
        }
    }

    @Test
    void anAttachmentIdThatIsNotUrlSafeIsKeptAsAPartWithNothingToDownload() {
        var parts = GmailMessageParser.parse(message(multipart("multipart/mixed", List.of(
                file("ok.txt", "text/plain", Map.of("attachmentId", "bad id/../x", "size", 1)))))).orElseThrow().attachments();

        assertEquals(1, parts.size());
        assertEquals(null, parts.getFirst().attachmentId());
        assertEquals(null, parts.getFirst().inlineData());
    }

    @Test
    @SuppressWarnings("unchecked")
    void hostilePartsAreBoundedAndNeverThrow() {
        // 100 levels deep: only the first 21 levels are walked
        Object deep = file("deep.txt", "text/plain", Map.of("attachmentId", "DEEP", "size", 1));
        for (int i = 0; i < 100; i++) {
            deep = multipart("multipart/mixed", List.of(deep));
        }
        assertEquals(List.of(), listed((Map<String, Object>) deep));

        // thousands of siblings: at most 50 attachments kept
        List<Object> many = new java.util.ArrayList<>();
        for (int i = 0; i < 5_000; i++) {
            many.add(file("f" + i + ".txt", "text/plain", Map.of("attachmentId", "A" + i, "size", 1)));
        }
        assertEquals(50, listed(multipart("multipart/mixed", many)).size());

        // wrong types everywhere
        Map<String, Object> weird = new java.util.LinkedHashMap<>();
        weird.put("mimeType", 7);
        weird.put("filename", List.of("x"));
        weird.put("body", "not a map");
        weird.put("parts", List.of("str", 1, Map.of("filename", "a.txt", "body", Map.of("attachmentId", 5, "data", 9, "size", "big")),
                Map.of("filename", "b.txt", "mimeType", "text/plain", "body", Map.of("attachmentId", "B", "size", -3L))));
        List<Map<String, Object>> list = listed(weird);
        assertEquals(1, list.size());
        assertEquals(0L, list.getFirst().get("size"));

        // a huge declared size stays a number, not an overflow
        assertEquals(Long.MAX_VALUE, listed(multipart("multipart/mixed", List.of(
                file("big.bin", "application/zip", Map.of("attachmentId", "A", "size", Long.MAX_VALUE))))).getFirst().get("size"));
    }

    @Test
    void aMessageReadAsMetadataOnlyHasNoAttachmentsAndAMessageWithoutAnyHasAnEmptyList() {
        Map<String, Object> payload = multipart("multipart/mixed", List.of(
                file("a.txt", "text/plain", Map.of("attachmentId", "A1", "size", 1))));

        var omitted = GmailMessageParser.parse(message(payload), true).orElseThrow();
        assertEquals(List.of(), omitted.input().get("attachments"));
        assertEquals(List.of(), omitted.attachments());
        assertEquals(List.of(), listed(part("text/plain", "plain")));
    }

    @Test
    void senderSplitsDisplayNameFromAddress() {
        assertEquals(List.of("Ada", "ada@example.test"), List.of(GmailMessageParser.sender("Ada <ada@example.test>")));
        assertEquals(List.of("Doe, Jane", "j@example.test"),
                List.of(GmailMessageParser.sender("\"Doe, Jane\" <j@example.test>")));
        assertEquals(List.of("", "bare@example.test"), List.of(GmailMessageParser.sender("bare@example.test")));
        assertEquals(List.of("", ""), List.of(GmailMessageParser.sender("")));
        // escaped quote inside the quoted name
        assertEquals(List.of("A \"B\" C", "c@d.e"), List.of(GmailMessageParser.sender("\"A \\\"B\\\" C\" <c@d.e>")));
        // lenient fallback: junk after the address group, name taken from the text before it
        assertEquals(List.of("Ada", "ada@example.test"), List.of(GmailMessageParser.sender("Ada <ada@example.test> (work)")));
        assertEquals(List.of("", "not-an-address"), List.of(GmailMessageParser.sender("<not-an-address>")));
        // a second <...> group outside quotes is ambiguous: keep the whole header, no name
        assertEquals(List.of("", "Ada <ada@x.com> (<evil@y.com>)"),
                List.of(GmailMessageParser.sender("Ada <ada@x.com> (<evil@y.com>)")));
        var input = GmailMessageParser.parse(message(headers(part("text/plain", "x"),
                "From", "\"Ada L\" <ada@example.test>"))).orElseThrow().input();
        assertEquals("ada@example.test", input.get("fromEmail"));
        assertEquals("Ada L", input.get("fromName"));
    }
}
