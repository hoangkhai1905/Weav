package com.weav.workflow.infrastructure.gmail;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GmailSendMessageTest {

    private static final String TOKEN = "synthetic-gmail-token";
    private static final String MESSAGE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/abc123";

    private static GmailClient.Outgoing outgoing(String senderName, String subject, String replyToMessageId) {
        return new GmailClient.Outgoing(List.of("a@example.test"), List.of(), List.of(), List.of(), senderName,
                subject, "Body", false, replyToMessageId, List.of());
    }

    private static ResolvedConnection connection() {
        return new ResolvedConnection("GMAIL", "OAUTH2", Map.of("accessToken", TOKEN));
    }

    private static PinnedHttpTransport.HttpResponse response(int status, Object data) {
        return new PinnedHttpTransport.HttpResponse(status, data, Map.of());
    }

    private static Map<String, Object> original(String threadId, String subject, String messageId, String references) {
        List<Map<String, String>> headers = new ArrayList<>(List.of(
                Map.of("name", "Subject", "value", subject), Map.of("name", "Message-ID", "value", messageId)));
        if (references != null) {
            headers.add(Map.of("name", "References", "value", references));
        }
        return Map.of("id", "abc123", "threadId", threadId, "payload", Map.of("headers", headers));
    }

    @Test
    void senderNameFetchesTheProfileAndSetsFromThroughTheMediaUpload() {
        FakeTransport transport = new FakeTransport();
        transport.profile = response(200, Map.of("emailAddress", "me@example.test"));

        Map<String, Object> result = new GmailClient(transport).sendMessage(outgoing("Nguyễn A", "Hi", null), connection());

        assertEquals("SENT", result.get("status"));
        assertEquals(List.of("profile"), transport.calls.subList(0, 1));
        assertEquals(GmailClient.UPLOAD_SEND_MEDIA_URI, transport.uploadUri);
        assertEquals("message/rfc822", transport.uploadBody.contentType());
        String mime = new String(transport.uploadBody.bytes(), StandardCharsets.UTF_8);
        assertTrue(mime.startsWith("From: =?UTF-8?B?"));
        assertTrue(mime.contains(" <me@example.test>\r\nTo: a@example.test\r\n"));
        assertEquals(TOKEN, transport.token);
    }

    @Test
    void replyReadsTheOriginalAndUploadsMultipartWithTheThreadId() {
        FakeTransport transport = new FakeTransport();
        transport.read = response(200, original("1234abcd", "Quarterly numbers", "<m2@mail.test>", "<m1@mail.test>"));

        new GmailClient(transport).sendMessage(outgoing(null, " ", "abc123"), connection());

        assertEquals(URI.create(MESSAGE_URL), transport.readUri);
        assertEquals(Map.of("format", "metadata"), transport.readQuery);
        assertEquals(GmailClient.UPLOAD_SEND_MULTIPART_URI, transport.uploadUri);
        assertTrue(transport.uploadBody.contentType().startsWith("multipart/related; boundary="));
        String wire = new String(transport.uploadBody.bytes(), StandardCharsets.UTF_8);
        assertTrue(wire.contains("{\"threadId\":\"1234abcd\"}"));
        assertTrue(wire.contains("In-Reply-To: <m2@mail.test>\r\n"));
        assertTrue(wire.contains("References: <m1@mail.test> <m2@mail.test>\r\n"));
        assertTrue(wire.contains("Subject: " + GmailClient.encodeHeaderWords("Re: Quarterly numbers") + "\r\n"));
    }

    @Test
    void aConfiguredSubjectIsKeptAndReOnTheOriginalIsNotDoubled() {
        FakeTransport kept = new FakeTransport();
        kept.read = response(200, original("1234abcd", "Original", "<m@mail.test>", null));
        new GmailClient(kept).sendMessage(outgoing(null, "My subject", "abc123"), connection());
        assertTrue(new String(kept.uploadBody.bytes(), StandardCharsets.UTF_8)
                .contains("Subject: " + GmailClient.encodeHeaderWords("My subject") + "\r\n"));

        FakeTransport again = new FakeTransport();
        again.read = response(200, original("1234abcd", "RE: Original", "<m@mail.test>", null));
        new GmailClient(again).sendMessage(outgoing(null, "", "abc123"), connection());
        assertTrue(new String(again.uploadBody.bytes(), StandardCharsets.UTF_8)
                .contains("Subject: " + GmailClient.encodeHeaderWords("RE: Original") + "\r\n"));
    }

    @Test
    void missingOriginalMessageIsANonRetryableFailureAndNothingIsSent() {
        FakeTransport transport = new FakeTransport();
        transport.read = response(404, Map.of());

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> new GmailClient(transport).sendMessage(outgoing(null, "", "abc123"), connection()));

        assertEquals("REPLY_MESSAGE_NOT_FOUND", failure.code());
        assertFalse(failure.retryable());
        assertEquals(0, transport.uploads);
    }

    @Test
    void retryableUploadFailureIsReportedAsUnknownOutcomeToAvoidDuplicates() {
        FakeTransport transport = new FakeTransport();
        transport.uploadFailure = new NodeExecutor.Failure("HTTP_DEPENDENCY_UNAVAILABLE", "x", true);

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> new GmailClient(transport).sendMessage(outgoing(null, "Hi", null), connection()));

        assertEquals("HTTP_DEPENDENCY_UNAVAILABLE", failure.code());
        assertFalse(failure.retryable());
    }

    @Test
    void nonAsciiMessageIdsAreDroppedButTheThreadIsStillSet() {
        for (String id : List.of("<a\u0085b@mail.test>", "<café@mail.test>")) {
            FakeTransport transport = new FakeTransport();
            transport.read = response(200, original("1234abcd", "Original", id, "<m1@mail.test>"));

            new GmailClient(transport).sendMessage(outgoing(null, "Hi", "abc123"), connection());

            String wire = new String(transport.uploadBody.bytes(), StandardCharsets.UTF_8);
            assertTrue(wire.contains("{\"threadId\":\"1234abcd\"}"));
            assertFalse(wire.contains("In-Reply-To"));
            assertFalse(wire.contains("References"));
        }
    }

    @Test
    void longReplySubjectIsTrimmedWithoutSplittingASurrogatePair() {
        FakeTransport transport = new FakeTransport();
        transport.read = response(200, original("1234abcd", "a".repeat(899) + "🚀", "<m@mail.test>", null));

        new GmailClient(transport).sendMessage(outgoing(null, "", "abc123"), connection());

        String wire = new String(transport.uploadBody.bytes(), StandardCharsets.UTF_8);
        String header = wire.substring(wire.indexOf("Subject: ") + 9, wire.indexOf("\r\nIn-Reply-To"));
        StringBuilder decoded = new StringBuilder();
        for (String word : header.split("\r\n ")) {
            decoded.append(new String(java.util.Base64.getDecoder().decode(
                    word.substring("=?UTF-8?B?".length(), word.length() - 2)), StandardCharsets.UTF_8));
        }
        assertEquals("Re: " + "a".repeat(899), decoded.toString());
    }

    @Test
    void invalidProfileResponseFailsBeforeSending() {
        FakeTransport transport = new FakeTransport();
        transport.profile = response(200, Map.of("emailAddress", "bad\r\naddress"));

        assertThrows(NodeExecutor.Failure.class,
                () -> new GmailClient(transport).sendMessage(outgoing("Name", "Hi", null), connection()));
        assertEquals(0, transport.uploads);
    }

    private static final class FakeTransport extends PinnedHttpTransport {
        private final List<String> calls = new ArrayList<>();
        private HttpResponse profile = response(200, Map.of("emailAddress", "me@example.test"));
        private HttpResponse read = response(200, Map.of());
        private NodeExecutor.Failure uploadFailure;
        private URI readUri;
        private Object readQuery;
        private URI uploadUri;
        private RawBody uploadBody;
        private String token;
        private int uploads;

        @Override
        public HttpResponse executeGmailProfileGetWithBearerToken(URI uri, String accessToken) {
            calls.add("profile");
            return profile;
        }

        @Override
        public HttpResponse executeGmailGetWithBearerToken(URI uri, Object query, String accessToken) {
            calls.add("read");
            readUri = uri;
            readQuery = query;
            return read;
        }

        @Override
        public HttpResponse executeGmailUploadSendWithBearerToken(
                URI uri, RawBody body, String accessToken, int maxRequestBytes) {
            calls.add("upload");
            uploads++;
            uploadUri = uri;
            uploadBody = body;
            token = accessToken;
            assertTrue(maxRequestBytes >= body.bytes().length && maxRequestBytes <= MAX_CALL_BYTES);
            if (uploadFailure != null) {
                throw uploadFailure;
            }
            return response(200, Map.of("id", "sent-1", "threadId", "t-1"));
        }
    }
}
