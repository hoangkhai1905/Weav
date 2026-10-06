package com.weav.workflow.infrastructure.gmail;

import com.weav.workflow.application.node.NodeExecutor;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MimeMessageBuilderTest {

    private static MimeMessageBuilder.Spec spec(List<MimeMessageBuilder.Attachment> attachments) {
        return new MimeMessageBuilder.Spec(null, null, List.of("a@example.test"), List.of(), List.of(), List.of(),
                "Hello", "Body text", false, null, null, attachments);
    }

    private static String build(MimeMessageBuilder.Spec spec) {
        return new String(MimeMessageBuilder.build(spec), StandardCharsets.UTF_8);
    }

    private static String decodedBody(String mime) {
        String encoded = mime.substring(mime.indexOf("\r\n\r\n") + 4).trim();
        return new String(Base64.getMimeDecoder().decode(encoded), StandardCharsets.UTF_8);
    }

    @Test
    void plainMessageMatchesTheLegacyShape() {
        String mime = build(spec(List.of()));
        // Same headers and body as GmailClient.mimeMessage (apart from the always-encoded Subject folding).
        assertEquals(GmailClient.mimeMessage(List.of("a@example.test"), "Hello", "Body text"), mime);
    }

    @Test
    void htmlBodyUsesTextHtml() {
        MimeMessageBuilder.Spec html = new MimeMessageBuilder.Spec(null, null, List.of("a@example.test"),
                List.of(), List.of(), List.of(), "Hi", "<p>Xin chào</p>", true, null, null, List.of());
        String mime = build(html);
        assertTrue(mime.contains("Content-Type: text/html; charset=UTF-8\r\n"));
        assertEquals("<p>Xin chào</p>", decodedBody(mime));
    }

    @Test
    void ccBccReplyToAndThreadHeaders() {
        MimeMessageBuilder.Spec s = new MimeMessageBuilder.Spec(null, null, List.of("a@example.test"),
                List.of("c1@example.test", "c2@example.test"), List.of("b@example.test"),
                List.of("r@example.test"), "Re: x", "B", false, "<one@mail.test>", "<zero@mail.test> <one@mail.test>",
                List.of());
        String mime = build(s);
        assertTrue(mime.contains("\r\nCc: c1@example.test, c2@example.test\r\n"));
        assertTrue(mime.contains("\r\nBcc: b@example.test\r\n"));
        assertTrue(mime.contains("\r\nReply-To: r@example.test\r\n"));
        assertTrue(mime.contains("\r\nIn-Reply-To: <one@mail.test>\r\n"));
        assertTrue(mime.contains("\r\nReferences: <zero@mail.test> <one@mail.test>\r\n"));
    }

    @Test
    void malformedMessageIdsAreDropped() {
        MimeMessageBuilder.Spec s = new MimeMessageBuilder.Spec(null, null, List.of("a@example.test"),
                List.of(), List.of(), List.of(), "x", "B", false, "not an id", "<a@b> junk", List.of());
        String mime = build(s);
        assertFalse(mime.contains("In-Reply-To"));
        assertFalse(mime.contains("References"));
    }

    @Test
    void senderNameIsEncodedBeforeTheAddress() {
        MimeMessageBuilder.Spec s = new MimeMessageBuilder.Spec("Nguyễn Văn A", "me@example.test",
                List.of("a@example.test"), List.of(), List.of(), List.of(), "Chào", "B", false, null, null, List.of());
        String mime = build(s);
        String from = mime.substring(0, mime.indexOf("\r\nTo:"));
        assertTrue(from.startsWith("From: =?UTF-8?B?"), from);
        assertTrue(from.endsWith(" <me@example.test>"), from);
        String payload = from.substring("From: =?UTF-8?B?".length(), from.indexOf("?= <"));
        assertEquals("Nguyễn Văn A", new String(Base64.getDecoder().decode(payload), StandardCharsets.UTF_8));
    }

    @Test
    void attachmentsProduceMultipartMixedWithWrappedBase64() {
        byte[] data = new byte[1000];
        for (int i = 0; i < data.length; i++) {
            data[i] = (byte) (i * 7);
        }
        String mime = build(spec(List.of(
                new MimeMessageBuilder.Attachment("report.pdf", "application/pdf", data),
                new MimeMessageBuilder.Attachment("empty.txt", "text/plain", new byte[0]))));

        String boundary = mime.substring(mime.indexOf("boundary=\"") + 10, mime.indexOf("\"\r\n\r\n"));
        assertTrue(boundary.startsWith("weav_"));
        assertTrue(mime.contains("Content-Type: multipart/mixed; boundary=\"" + boundary + "\"\r\n"));
        assertTrue(mime.endsWith("--" + boundary + "--\r\n"));
        String[] parts = mime.split("--" + boundary + "\r\n");
        assertEquals(4, parts.length - 0); // preamble headers, text, two attachments
        String pdf = parts[2];
        assertTrue(pdf.contains("Content-Type: application/pdf; name=\"report.pdf\"\r\n"));
        assertTrue(pdf.contains("Content-Disposition: attachment; filename=\"report.pdf\"\r\n"));
        String encoded = pdf.substring(pdf.indexOf("\r\n\r\n") + 4);
        for (String line : encoded.split("\r\n")) {
            assertTrue(line.length() <= 76);
        }
        assertTrue(Arrays.equals(data, Base64.getMimeDecoder().decode(encoded.trim())));
        assertTrue(parts[3].contains("filename=\"empty.txt\""));
        assertEquals("Body text", new String(Base64.getMimeDecoder().decode(
                parts[1].substring(parts[1].indexOf("\r\n\r\n") + 4).trim()), StandardCharsets.UTF_8));
    }

    @Test
    void nonAsciiAndLongFilenamesUseRfc2231Continuations() {
        String name = "Báo cáo tuần 🚀 " + "x".repeat(40) + ".pdf";
        String parameter = MimeMessageBuilder.parameter("filename", name);
        assertTrue(parameter.startsWith(" filename*0*=UTF-8''"));
        assertTrue(parameter.contains(";\r\n filename*1*="));
        ByteArrayOutputStream decoded = new ByteArrayOutputStream();
        for (String segment : parameter.split(";\r\n ")) {
            String value = segment.substring(segment.indexOf('=') + 1).replace("UTF-8''", "");
            for (int i = 0; i < value.length(); i++) {
                if (value.charAt(i) == '%') {
                    decoded.write(Integer.parseInt(value.substring(i + 1, i + 3), 16));
                    i += 2;
                } else {
                    decoded.write(value.charAt(i));
                }
            }
        }
        assertEquals(name, decoded.toString(StandardCharsets.UTF_8));
        for (String line : parameter.split("\r\n")) {
            assertTrue(line.length() < 100);
        }
        assertEquals(" filename=\"plain.txt\"", MimeMessageBuilder.parameter("filename", "plain.txt"));
        assertTrue(MimeMessageBuilder.parameter("filename", "a\"b.txt").startsWith(" filename*0*="));
    }

    @Test
    void unsafeMediaTypeFallsBackToOctetStream() {
        String mime = build(spec(List.of(new MimeMessageBuilder.Attachment("a.bin", "x/y\r\nBcc: z@e.test", new byte[1]))));
        assertTrue(mime.contains("Content-Type: application/octet-stream; name=\"a.bin\""));
        assertFalse(mime.contains("Bcc:"));
    }

    @Test
    void boundariesDifferPerMessage() {
        String first = build(spec(List.of(new MimeMessageBuilder.Attachment("a", "text/plain", new byte[1]))));
        String second = build(spec(List.of(new MimeMessageBuilder.Attachment("a", "text/plain", new byte[1]))));
        assertFalse(first.substring(first.indexOf("boundary="), first.indexOf("\r\n\r\n"))
                .equals(second.substring(second.indexOf("boundary="), second.indexOf("\r\n\r\n"))));
    }

    @Test
    void everyHeaderValueRejectsControlCharacters() {
        String bad = "x\r\nBcc: victim@example.test";
        List<Function<String, MimeMessageBuilder.Spec>> fields = List.of(
                v -> new MimeMessageBuilder.Spec(null, null, List.of(v), List.of(), List.of(), List.of(), "s", "b", false, null, null, List.of()),
                v -> new MimeMessageBuilder.Spec(null, null, List.of("a@example.test"), List.of(v), List.of(), List.of(), "s", "b", false, null, null, List.of()),
                v -> new MimeMessageBuilder.Spec(null, null, List.of("a@example.test"), List.of(), List.of(v), List.of(), "s", "b", false, null, null, List.of()),
                v -> new MimeMessageBuilder.Spec(null, null, List.of("a@example.test"), List.of(), List.of(), List.of(v), "s", "b", false, null, null, List.of()),
                v -> new MimeMessageBuilder.Spec(null, null, List.of("a@example.test"), List.of(), List.of(), List.of(), v, "b", false, null, null, List.of()),
                v -> new MimeMessageBuilder.Spec(v, "me@example.test", List.of("a@example.test"), List.of(), List.of(), List.of(), "s", "b", false, null, null, List.of()),
                v -> new MimeMessageBuilder.Spec("n", v, List.of("a@example.test"), List.of(), List.of(), List.of(), "s", "b", false, null, null, List.of()),
                v -> spec(List.of(new MimeMessageBuilder.Attachment(v, "text/plain", new byte[1]))));
        for (Function<String, MimeMessageBuilder.Spec> field : fields) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> MimeMessageBuilder.build(field.apply(bad)));
            assertEquals("CONFIGURATION_ERROR", failure.code());
        }
    }
}
