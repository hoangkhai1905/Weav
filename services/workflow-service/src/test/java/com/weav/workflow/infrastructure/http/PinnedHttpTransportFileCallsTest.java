package com.weav.workflow.infrastructure.http;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.weav.workflow.application.node.NodeExecutor;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Transport additions for the workflow file store: per-call caps, Gmail upload/attachment, binary download. */
class PinnedHttpTransportFileCallsTest {

    private static final int DEFAULT_CAP = 64 * 1024;
    private static final String MESSAGE = "https://gmail.googleapis.com/gmail/v1/users/me/messages/18c0ffee00000001";

    private final PinnedHttpTransport transport = new PinnedHttpTransport(
            Duration.ofSeconds(1), Duration.ofSeconds(5), DEFAULT_CAP, DEFAULT_CAP, 16 * 1024, new ObjectMapper());
    private HttpServer server;

    @AfterEach
    void stop() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void gmailUploadSendAcceptsOnlyTheTwoUploadTypes() {
        assertEquals("media", transport.validateGmailUploadSendUri(uploadUri("uploadType=media")));
        assertEquals("multipart", transport.validateGmailUploadSendUri(uploadUri("uploadType=multipart")));
        for (String bad : List.of(
                "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send",
                "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=resumable",
                "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media&x=1",
                "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media#f",
                "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=Media",
                "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send/?uploadType=media",
                "https://gmail.googleapis.com/upload/gmail/v1/users/me/drafts?uploadType=media",
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/send?uploadType=media",
                "https://gmail.googleapis.com/upload/gmail/v1/users/other/messages/send?uploadType=media",
                "http://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media",
                "https://gmail.googleapis.com:8443/upload/gmail/v1/users/me/messages/send?uploadType=media",
                "https://user@gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media",
                "https://www.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media",
                "https://gmail.googleapis.com.evil.example/upload/gmail/v1/users/me/messages/send?uploadType=media")) {
            assertInvalid(() -> transport.validateGmailUploadSendUri(URI.create(bad)), bad);
        }
        assertInvalid(() -> transport.validateGmailUploadSendUri(null), "null");
    }

    @Test
    void gmailUploadSendRejectsAWrongBodyTypeTokenOrCapBeforeAnyNetworkCall() {
        URI media = uploadUri("uploadType=media");
        URI multipart = uploadUri("uploadType=multipart");
        byte[] bytes = "x".getBytes(StandardCharsets.UTF_8);
        PinnedHttpTransport.RawBody rfc822 = new PinnedHttpTransport.RawBody(bytes, "message/rfc822");
        PinnedHttpTransport.RawBody related = new PinnedHttpTransport.RawBody(bytes, "multipart/related; boundary=b");

        assertInvalid(() -> transport.executeGmailUploadSendWithBearerToken(media, related, "t", 1024), "media/related");
        assertInvalid(() -> transport.executeGmailUploadSendWithBearerToken(multipart, rfc822, "t", 1024), "multi/rfc822");
        assertInvalid(() -> transport.executeGmailUploadSendWithBearerToken(media, null, "t", 1024), "null body");
        assertInvalid(() -> transport.executeGmailUploadSendWithBearerToken(media,
                new PinnedHttpTransport.RawBody(new byte[0], "message/rfc822"), "t", 1024), "empty body");
        assertInvalid(() -> transport.executeGmailUploadSendWithBearerToken(media, rfc822, "bad\ntoken", 1024), "token");
        assertThrows(IllegalArgumentException.class,
                () -> transport.executeGmailUploadSendWithBearerToken(media, rfc822, "t", 0));
        assertThrows(IllegalArgumentException.class, () -> transport.executeGmailUploadSendWithBearerToken(
                media, rfc822, "t", PinnedHttpTransport.MAX_CALL_BYTES + 1));
    }

    @Test
    void multipartRelatedCarriesTheThreadIdAndTheMessage() {
        PinnedHttpTransport.RawBody body = PinnedHttpTransport.gmailMultipartRelated(
                "18c0ffee00000001", "Subject: hi\r\n\r\nbody".getBytes(StandardCharsets.UTF_8));
        String text = new String(body.bytes(), StandardCharsets.UTF_8);
        String boundary = body.contentType().substring(body.contentType().indexOf("boundary=") + 9);

        assertTrue(body.contentType().startsWith("multipart/related; boundary=weav_"));
        assertTrue(text.startsWith("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
                + "{\"threadId\":\"18c0ffee00000001\"}\r\n--" + boundary + "\r\nContent-Type: message/rfc822\r\n\r\n"
                + "Subject: hi"));
        assertTrue(text.endsWith("body\r\n--" + boundary + "--"));
        assertInvalid(() -> PinnedHttpTransport.gmailMultipartRelated("x\",\"labelIds", new byte[1]), "thread id");
    }

    @Test
    void gmailAttachmentPathIsExact() {
        for (String ok : List.of(
                MESSAGE + "/attachments/ANGjdJ_8x-Zq",
                "https://GMAIL.googleapis.com:443/gmail/v1/users/me/messages/ABCDEF0123/attachments/" + "a".repeat(2048))) {
            assertDoesNotThrow(() -> transport.validateGmailAttachmentUri(URI.create(ok)), ok);
        }
        for (String bad : List.of(
                MESSAGE + "/attachments/",
                MESSAGE + "/attachments/a/b",
                MESSAGE + "/attachments/a%2Fb",
                MESSAGE + "/attachments/..",
                MESSAGE + "/attachments/a.b",
                MESSAGE + "/attachments/" + "a".repeat(2049),
                MESSAGE + "/attachments/abc?alt=media",
                MESSAGE + "/attachments/abc#f",
                MESSAGE + "/attachments",
                MESSAGE + "/trash",
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/zz/attachments/abc",
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + "a".repeat(33) + "/attachments/abc",
                "https://gmail.googleapis.com/gmail/v1/users/other/messages/18c0ffee/attachments/abc",
                "http://gmail.googleapis.com/gmail/v1/users/me/messages/18c0ffee/attachments/abc",
                "https://www.googleapis.com/gmail/v1/users/me/messages/18c0ffee/attachments/abc")) {
            assertInvalid(() -> transport.validateGmailAttachmentUri(URI.create(bad)), bad);
        }
        assertInvalid(() -> transport.validateGmailAttachmentUri(null), "null");
        assertInvalid(() -> transport.executeGmailAttachmentGetWithBearerToken(
                URI.create(MESSAGE + "/attachments/abc"), " ", 1024), "token");
        assertThrows(IllegalArgumentException.class, () -> transport.executeGmailAttachmentGetWithBearerToken(
                URI.create(MESSAGE + "/attachments/abc"), "t", PinnedHttpTransport.MAX_CALL_BYTES + 1));
    }

    @Test
    void theExistingGmailReadAllowListStillRejectsAttachments() {
        assertInvalid(() -> transport.validateGmailReadUri(URI.create(MESSAGE + "/attachments/abc")), "read/attachments");
    }

    @Test
    void calendarEventsAllowGetAndPostButNothingElse() {
        String events = "https://www.googleapis.com/calendar/v3/calendars/a%2Fb%40x.test/events";
        assertDoesNotThrow(() -> transport.validateGoogleApiUri(URI.create(events), "GET"));
        assertDoesNotThrow(() -> transport.validateGoogleApiUri(URI.create(events), "POST"));
        assertDoesNotThrow(() -> transport.validateGoogleApiUri(URI.create("https://www.googleapis.com/drive/v3/files"), "GET"));
        assertDoesNotThrow(() -> transport.validateGoogleApiUri(
                URI.create("https://www.googleapis.com/upload/drive/v3/files"), "POST"));
        for (String[] bad : new String[][] {
                {events, "DELETE"}, {events, "PUT"}, {events, "PATCH"},
                {events + "/abc", "GET"}, {events + "/../x", "GET"},
                {"https://www.googleapis.com/calendar/v3/calendars/a%2F..%2Fb/events/", "GET"},
                {"https://www.googleapis.com/calendar/v3/users/me/calendarList", "GET"},
                {"https://www.googleapis.com/upload/drive/v3/files", "GET"},
                {"https://www.googleapis.com/drive/v3/files", "POST"},
                {"https://www.googleapis.com/drive/v3/files/abc", "GET"},
                {"https://calendar.googleapis.com/calendar/v3/calendars/primary/events", "GET"}}) {
            assertInvalid(() -> transport.validateGoogleApiUri(URI.create(bad[0]), bad[1]), bad[1] + " " + bad[0]);
        }
    }

    @Test
    void driveUploadCapIsBoundedByTheCeilingAndOtherEndpointsKeepTheDefault() {
        URI upload = URI.create("https://www.googleapis.com/upload/drive/v3/files");
        assertThrows(IllegalArgumentException.class, () -> transport.executeGoogleApiWithBearerToken(
                upload, "POST", Map.of("uploadType", "multipart"), null, "t", PinnedHttpTransport.MAX_CALL_BYTES + 1));
        assertThrows(IllegalArgumentException.class, () -> transport.executeGoogleApiWithBearerToken(
                upload, "POST", Map.of("uploadType", "multipart"), null, "t", 0));
    }

    @Test
    void perCallCapsApplyOnlyToTheCallThatPassesThem() throws Exception {
        byte[] big = new byte[100 * 1024];
        start("/echo", exchange -> {
            exchange.getRequestBody().readAllBytes();
            respond(exchange, 200, "application/json", "{\"ok\":true}", null);
        });
        start2("/big", exchange -> respond(exchange, 200, "application/octet-stream", big, null));
        URI echo = local("/echo");
        PinnedHttpTransport.RawBody body = new PinnedHttpTransport.RawBody(big, "application/octet-stream");

        // Default cap: both directions are refused.
        assertEquals("HTTP_REQUEST_TOO_LARGE", assertThrows(NodeExecutor.Failure.class,
                () -> transport.executeWithAuthentication(approved(echo), "POST", Map.of(), Map.of(), null, body)).code());
        assertEquals("HTTP_RESPONSE_TOO_LARGE", assertThrows(NodeExecutor.Failure.class,
                () -> transport.executeWithAuthentication(approved(local("/big")), "GET", Map.of(), Map.of(), null, null))
                .code());
        // Larger per-call caps: both directions pass.
        assertEquals(200, transport.executeWithAuthentication(approved(echo), "POST", Map.of(), Map.of(), null, body,
                Duration.ofSeconds(5), 200 * 1024, DEFAULT_CAP, false).status());
        assertEquals(200, transport.executeWithAuthentication(approved(local("/big")), "GET", Map.of(), Map.of(), null,
                null, Duration.ofSeconds(5), DEFAULT_CAP, 200 * 1024, true).status());
        // A larger cap is still a cap.
        assertEquals("HTTP_REQUEST_TOO_LARGE", assertThrows(NodeExecutor.Failure.class,
                () -> transport.executeWithAuthentication(approved(echo), "POST", Map.of(), Map.of(), null, body,
                        Duration.ofSeconds(5), 50 * 1024, DEFAULT_CAP, false)).code());
        assertEquals("HTTP_RESPONSE_TOO_LARGE", assertThrows(NodeExecutor.Failure.class,
                () -> transport.executeWithAuthentication(approved(local("/big")), "GET", Map.of(), Map.of(), null, null,
                        Duration.ofSeconds(5), DEFAULT_CAP, 50 * 1024, true)).code());
    }

    @Test
    void downloadReturnsRawBytesTypeAndSanitizedFilename() throws Exception {
        byte[] binary = {0, (byte) 0xff, (byte) 0xfe, 'P', 'D', 'F', (byte) 0x80};
        start("/file", exchange -> respond(exchange, 200, "application/pdf; charset=binary", binary,
                "attachment; filename=\"../../evil\\name.pdf\""));
        AtomicHeaders seen = new AtomicHeaders();
        server.createContext("/seen", exchange -> {
            seen.authorization = exchange.getRequestHeaders().getFirst("Authorization");
            seen.method = exchange.getRequestMethod();
            respond(exchange, 200, "text/plain", "x".getBytes(StandardCharsets.UTF_8), null);
        });

        PinnedHttpTransport.Download download = transport.download(approved(local("/file")), DEFAULT_CAP);
        assertEquals(200, download.status());
        assertArrayEquals(binary, download.bytes());
        assertEquals("application/pdf", download.contentType());
        assertEquals("....evilname.pdf", download.filename());

        transport.download(approved(local("/seen")), DEFAULT_CAP);
        assertEquals("GET", seen.method);
        assertNull(seen.authorization);
    }

    @Test
    void downloadFailsOnNon2xxRedirectAndOversizedBodies() throws Exception {
        start("/missing", exchange -> respond(exchange, 404, "text/plain", new byte[0], null));
        server.createContext("/moved", exchange -> {
            exchange.getResponseHeaders().set("Location", "http://127.0.0.1:1/");
            respond(exchange, 302, "text/plain", new byte[0], null);
        });
        server.createContext("/busy", exchange -> respond(exchange, 503, "text/plain", new byte[0], null));
        server.createContext("/large", exchange -> respond(exchange, 200, "application/zip", new byte[2048], null));

        assertDownloadFailure("HTTP_BUSINESS_REJECTED", false, "/missing", DEFAULT_CAP);
        assertDownloadFailure("HTTP_REDIRECT_REJECTED", false, "/moved", DEFAULT_CAP);
        assertDownloadFailure("HTTP_DEPENDENCY_UNAVAILABLE", true, "/busy", DEFAULT_CAP);
        assertDownloadFailure("HTTP_RESPONSE_TOO_LARGE", false, "/large", 1024);
        assertEquals(2048, transport.download(approved(local("/large")), 4096).bytes().length);
    }

    @Test
    void anUnknownLengthResponseIsCappedWhileStreaming() throws Exception {
        start("/chunked", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "application/octet-stream");
            exchange.sendResponseHeaders(200, 0); // chunked, no Content-Length
            try (exchange) {
                byte[] chunk = new byte[1024];
                for (int i = 0; i < 64; i++) {
                    exchange.getResponseBody().write(chunk);
                }
            } catch (IOException clientClosed) {
                // the transport stops reading once the cap is hit
            }
        });

        assertDownloadFailure("HTTP_RESPONSE_TOO_LARGE", false, "/chunked", 4096);
        assertEquals(64 * 1024, transport.download(approved(local("/chunked")), 128 * 1024).bytes().length);
    }

    @Test
    void publicDownloadRejectsPrivateLoopbackAndMetadataTargetsBeforeConnecting() {
        for (String target : List.of(
                "http://127.0.0.1/file", "http://localhost/file", "http://10.0.0.1/file",
                "http://192.168.1.1/file", "http://169.254.169.254/latest/meta-data", "http://[::1]/file",
                "http://[::ffff:127.0.0.1]/file", "ftp://example.com/file", "file:///etc/passwd")) {
            assertThrows(NodeExecutor.Failure.class,
                    () -> transport.downloadPublicFile(URI.create(target), DEFAULT_CAP), target);
        }
        assertThrows(IllegalArgumentException.class, () -> transport.downloadPublicFile(
                URI.create("https://example.com/f"), PinnedHttpTransport.MAX_CALL_BYTES + 1));
    }

    @Test
    void contentDispositionFilenames() {
        assertEquals("a.pdf", PinnedHttpTransport.dispositionFilename("attachment; filename=a.pdf"));
        assertEquals("my file.pdf", PinnedHttpTransport.dispositionFilename("attachment; filename=\"my file.pdf\""));
        assertEquals("résumé.pdf", PinnedHttpTransport.dispositionFilename(
                "attachment; filename=\"fallback.pdf\"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf"));
        assertEquals("abx.txt", PinnedHttpTransport.dispositionFilename("attachment; filename=\"a/b\\x.txt\""));
        assertEquals("evilpdf.exe", PinnedHttpTransport.dispositionFilename("attachment; filename=\"evil‮fdp.exe\"")
                .replace("fdp", "pdf").replace("evilpdf", "evilpdf"));
        assertEquals("evilfdp.exe", PinnedHttpTransport.dispositionFilename("attachment; filename=\"evil‮fdp.exe\""));
        assertNull(PinnedHttpTransport.dispositionFilename("inline"));
        assertNull(PinnedHttpTransport.dispositionFilename(null));
        assertNull(PinnedHttpTransport.dispositionFilename("attachment; filename=\"..\""));
        assertFalse(PinnedHttpTransport.dispositionFilename("attachment; filename=\"" + "a".repeat(400) + "\"")
                .length() > 255);
    }

    private void assertDownloadFailure(String code, boolean retryable, String path, int cap) {
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> transport.download(approved(local(path)), cap), path);
        assertEquals(code, failure.code(), path);
        assertEquals(retryable, failure.retryable(), path);
    }

    private static URI uploadUri(String query) {
        return URI.create("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?" + query);
    }

    private static void assertInvalid(org.junit.jupiter.api.function.Executable call, String label) {
        assertEquals("HTTP_REQUEST_INVALID", assertThrows(NodeExecutor.Failure.class, call, label).code(), label);
    }

    private URI local(String path) {
        return URI.create("http://public.example.test:" + server.getAddress().getPort() + path);
    }

    private static OutboundTargetPolicy.ApprovedTarget approved(URI uri) throws IOException {
        return new OutboundTargetPolicy.ApprovedTarget(uri, List.of(InetAddress.getByName("127.0.0.1")));
    }

    private void start(String path, Handler handler) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(path, handler::handle);
        server.start();
    }

    private void start2(String path, Handler handler) {
        server.createContext(path, handler::handle);
    }

    private static void respond(HttpExchange exchange, int status, String contentType, String body, String disposition)
            throws IOException {
        respond(exchange, status, contentType, body.getBytes(StandardCharsets.UTF_8), disposition);
    }

    private static void respond(HttpExchange exchange, int status, String contentType, byte[] body, String disposition)
            throws IOException {
        exchange.getResponseHeaders().set("Content-Type", contentType);
        if (disposition != null) {
            exchange.getResponseHeaders().set("Content-Disposition", disposition);
        }
        exchange.sendResponseHeaders(status, body.length == 0 ? -1 : body.length);
        try (exchange) {
            if (body.length > 0) {
                exchange.getResponseBody().write(body);
            }
        }
    }

    private static final class AtomicHeaders {
        volatile String authorization;
        volatile String method;
    }

    @FunctionalInterface
    private interface Handler {
        void handle(HttpExchange exchange) throws IOException;
    }
}
