package com.weav.workflow.infrastructure.gmail;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GmailContractTest {

    private static final String TOKEN = "synthetic-gmail-token";

    @Test
    void sendPostsRawRfc2822MessageToTheFixedGmailEndpoint() {
        RecordingTransport transport = new RecordingTransport(
                response(200, Map.of("id", "msg-1", "threadId", "thread-1", "labelIds", List.of("SENT"))));
        GmailClient client = new GmailClient(transport);
        ResolvedConnection connection = connection();

        Map<String, Object> result = client.send(
                List.of("a@example.test", "b@example.test"), "Báo cáo tuần", "Xin chào\nDòng 2", connection);
        connection.close();

        assertEquals(Map.of("messageId", "msg-1", "threadId", "thread-1", "status", "SENT"), result);
        assertEquals(URI.create("https://gmail.googleapis.com/gmail/v1/users/me/messages/send"), transport.uri);
        assertEquals(TOKEN, transport.accessToken);
        Map<?, ?> body = assertInstanceOf(Map.class, transport.body);
        assertEquals(1, body.size());
        String mime = new String(Base64.getUrlDecoder().decode((String) body.get("raw")), StandardCharsets.UTF_8);
        assertTrue(mime.startsWith("To: a@example.test, b@example.test\r\n"));
        assertTrue(mime.contains("Content-Type: text/plain; charset=UTF-8\r\n"));
        assertEquals("Báo cáo tuần", decodeSubject(mime));
        String encodedBody = mime.substring(mime.indexOf("\r\n\r\n") + 4).trim();
        assertEquals("Xin chào\nDòng 2",
                new String(Base64.getMimeDecoder().decode(encodedBody), StandardCharsets.UTF_8));
    }

    @Test
    void longUnicodeSubjectIsFoldedIntoShortEncodedWordsWithoutSplittingCharacters() {
        String subject = "Thông báo quan trọng về tiến độ dự án tự động hoá 🚀 ".repeat(4);

        String header = GmailClient.encodeHeaderWords(subject);

        for (String word : header.split("\r\n ")) {
            assertTrue(word.length() <= 75, "encoded word exceeds RFC 2047 limit: " + word.length());
        }
        assertEquals(subject, decodeSubject("Subject: " + header + "\r\n"));
    }

    @Test
    void aQuotaRefusalIsRetryableBecauseNothingWasSentButOtherForbiddenIsNot() {
        Map<String, Object> quota = Map.of("error", Map.of("errors", List.of(Map.of("reason", "userRateLimitExceeded"))));
        NodeExecutor.Failure limited = assertThrows(NodeExecutor.Failure.class, () -> new GmailClient(
                new RecordingTransport(response(403, quota))).send(List.of("a@example.test"), "Hi", "B", connection()));
        assertEquals("HTTP_RATE_LIMITED", limited.code());
        assertTrue(limited.retryable() && limited.requestNotSent());

        NodeExecutor.Failure forbidden = assertThrows(NodeExecutor.Failure.class, () -> new GmailClient(
                new RecordingTransport(response(403, Map.of()))).send(List.of("a@example.test"), "Hi", "B", connection()));
        assertEquals("HTTP_BUSINESS_REJECTED", forbidden.code());
        assertFalse(forbidden.retryable());
    }

    @Test
    void classifiesStatusesAndNeverRetriesWhenTheEmailMayHaveBeenSent() {
        for (StatusCase statusCase : List.of(
                new StatusCase(401, "AUTHENTICATION_REJECTED", false),
                new StatusCase(403, "HTTP_BUSINESS_REJECTED", false),
                new StatusCase(400, "HTTP_BUSINESS_REJECTED", false),
                new StatusCase(429, "HTTP_RATE_LIMITED", true),
                new StatusCase(302, "HTTP_REDIRECT_REJECTED", false),
                new StatusCase(503, "HTTP_DEPENDENCY_UNAVAILABLE", false),
                new StatusCase(408, "HTTP_DEPENDENCY_UNAVAILABLE", false))) {
            RecordingTransport transport = new RecordingTransport(
                    response(statusCase.status(), Map.of("error", "provider-secret-detail")));
            GmailClient client = new GmailClient(transport);

            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> client.send(List.of("a@example.test"), "Hi", "Body", connection()));

            assertEquals(statusCase.code(), failure.code(), "status " + statusCase.status());
            assertEquals(statusCase.retryable(), failure.retryable(), "status " + statusCase.status());
            assertFalse(failure.getMessage().contains("provider-secret-detail"));
        }
    }

    @Test
    void retryableTransportFailuresBecomeTerminalToAvoidDuplicateEmails() {
        RecordingTransport transport = new RecordingTransport(null);
        transport.failure = new NodeExecutor.Failure("HTTP_TIMEOUT", "The HTTP request timed out.", true);
        GmailClient client = new GmailClient(transport);

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> client.send(List.of("a@example.test"), "Hi", "Body", connection()));

        assertEquals("HTTP_TIMEOUT", failure.code());
        assertFalse(failure.retryable());
    }

    @Test
    void successWithoutMessageIdIsAnUnknownOutcomeNotARetry() {
        RecordingTransport transport = new RecordingTransport(response(200, Map.of("threadId", "t")));
        GmailClient client = new GmailClient(transport);

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> client.send(List.of("a@example.test"), "Hi", "Body", connection()));

        assertFalse(failure.retryable());
    }

    @Test
    void requiresTheExactWorkspaceGmailOauthContractBeforeTransport() {
        RecordingTransport transport = new RecordingTransport(response(200, Map.of("id", "msg-1")));
        GmailClient client = new GmailClient(transport);
        for (ResolvedConnection connection : List.of(
                new ResolvedConnection("GOOGLE_SHEETS", "OAUTH2", Map.of("accessToken", TOKEN)),
                new ResolvedConnection("GMAIL", "TOKEN", Map.of("token", TOKEN)),
                new ResolvedConnection("GMAIL", "OAUTH2",
                        Map.of("accessToken", TOKEN, "refreshToken", "synthetic-refresh-token")))) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> client.send(List.of("a@example.test"), "Hi", "Body", connection));
            connection.close();
            assertEquals("CONNECTION_CONFIGURATION_INVALID", failure.code());
            assertFalse(failure.retryable());
            assertFalse(transport.called);
        }
    }

    /** Decodes a (possibly folded) RFC 2047 Subject header back to text. */
    private static String decodeSubject(String mime) {
        int start = mime.indexOf("Subject: ") + "Subject: ".length();
        int end = start;
        while (true) {
            int lineBreak = mime.indexOf("\r\n", end);
            if (lineBreak < 0 || lineBreak + 2 >= mime.length() || mime.charAt(lineBreak + 2) != ' ') {
                end = lineBreak < 0 ? mime.length() : lineBreak;
                break;
            }
            end = lineBreak + 2;
        }
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        for (String word : mime.substring(start, end).split("\r\n ")) {
            String payload = word.substring("=?UTF-8?B?".length(), word.length() - "?=".length());
            bytes.writeBytes(Base64.getDecoder().decode(payload));
        }
        return bytes.toString(StandardCharsets.UTF_8);
    }

    private static ResolvedConnection connection() {
        return new ResolvedConnection("GMAIL", "OAUTH2", Map.of("accessToken", TOKEN));
    }

    private static PinnedHttpTransport.HttpResponse response(int status, Object data) {
        return new PinnedHttpTransport.HttpResponse(status, data, Map.of());
    }

    private record StatusCase(int status, String code, boolean retryable) {
    }

    private static final class RecordingTransport extends PinnedHttpTransport {
        private final HttpResponse response;
        private NodeExecutor.Failure failure;
        private boolean called;
        private URI uri;
        private Object body;
        private String accessToken;

        private RecordingTransport(HttpResponse response) {
            super();
            this.response = response;
        }

        @Override
        public HttpResponse executeGmailSendWithBearerToken(URI target, Object body, String accessToken) {
            this.called = true;
            this.uri = target;
            this.body = body;
            this.accessToken = accessToken;
            if (failure != null) {
                throw failure;
            }
            return response;
        }
    }
}
