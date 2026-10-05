package com.weav.workflow.infrastructure.gmail;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.GmailMailboxPort;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.BiFunction;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GmailMailboxTest {

    private static final String TOKEN = "synthetic-gmail-token";
    private static final long BASE = 1_790_000_000_000L;

    private static ResolvedConnection connection() {
        return new ResolvedConnection("GMAIL", "OAUTH2", Map.of("accessToken", TOKEN));
    }

    private static PinnedHttpTransport.HttpResponse json(int status, Object data) {
        return new PinnedHttpTransport.HttpResponse(status, data, Map.of());
    }

    private static String id(int n) {
        return String.format("aaaa%04x", n);
    }

    private static Map<String, Object> message(String id, long internalDate, String text) {
        return Map.of("id", id, "threadId", "t-" + id, "internalDate", Long.toString(internalDate), "snippet", "s",
                "payload", Map.of("mimeType", "text/plain", "filename", "", "body", Map.of("data",
                        Base64.getUrlEncoder().withoutPadding().encodeToString(text.getBytes(StandardCharsets.UTF_8)))));
    }

    /** n messages m1..mn, one every 10 s from BASE, served like Gmail: newest first, filtered by after:. */
    private static FakeTransport mailboxOf(int n) {
        return new FakeTransport((uri, query) -> {
            if (uri.getPath().endsWith("/messages")) {
                long after = Long.parseLong(((String) query.get("q")).replaceAll(".*after:", "")) * 1000;
                List<Map<String, Object>> ids = new ArrayList<>();
                for (int i = n; i >= 1; i--) {
                    if (BASE + i * 10_000L >= after) {
                        ids.add(Map.of("id", id(i)));
                    }
                }
                int limit = Math.min(ids.size(), (Integer) query.get("maxResults"));
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("messages", ids.subList(0, limit));
                if (limit < ids.size()) {
                    body.put("nextPageToken", "next-" + limit);
                }
                return json(200, body);
            }
            int i = Integer.parseInt(uri.getPath().substring(uri.getPath().lastIndexOf('/') + 5), 16);
            return json(200, message(id(i), BASE + i * 10_000L, "body " + i));
        });
    }

    @Test
    void listsWithTheSearchAndCursorThenReadsEachMessageAndReturnsThemOldestFirst() {
        FakeTransport transport = mailboxOf(3);
        GmailMailbox mailbox = new GmailMailbox(new GmailClient(transport));

        GmailMailboxPort.FetchResult result = mailbox.fetchNew(
                connection(), "from:billing@example.test", Instant.ofEpochMilli(BASE), 10);

        assertEquals(List.of(id(1), id(2), id(3)), result.messages().stream().map(GmailMailboxPort.Message::id).toList());
        assertEquals("body 1", result.messages().getFirst().input().get("body"));
        assertEquals(null, result.notice());
        FakeTransport.Call list = transport.calls.getFirst();
        assertEquals("https://gmail.googleapis.com/gmail/v1/users/me/messages", list.uri().toString());
        assertEquals("from:billing@example.test after:1789999999", list.query().get("q"));
        assertEquals(100, list.query().get("maxResults"));
        assertEquals(TOKEN, list.token());
        assertEquals(Map.of("format", "full"), transport.calls.get(1).query());
    }

    @Test
    void withoutAQueryOnlyTheCursorFilterIsSentAndNothingIsRead() {
        FakeTransport transport = new FakeTransport((uri, query) -> json(200, Map.of("resultSizeEstimate", 0)));

        GmailMailboxPort.FetchResult result = new GmailMailbox(new GmailClient(transport))
                .fetchNew(connection(), null, Instant.ofEpochSecond(42), 10);

        assertTrue(result.messages().isEmpty());
        assertEquals("after:41", transport.calls.getFirst().query().get("q"));
        assertEquals(1, transport.calls.size());
    }

    @Test
    void mailFromBeforeTheCursorIsDroppedAndMailAtOrAfterItIsKept() {
        // publish at BASE+25 s: m1 (10 s) and m2 (20 s) predate it, m3 (30 s) is newer.
        Instant cursor = Instant.ofEpochMilli(BASE + 25_000);

        GmailMailboxPort.FetchResult result = new GmailMailbox(new GmailClient(mailboxOf(3)))
                .fetchNew(connection(), null, cursor, 10);

        assertEquals(List.of(id(3)), result.messages().stream().map(GmailMailboxPort.Message::id).toList());

        // The newest admitted email (equal timestamp) is listed again and kept; the idempotency key dedupes it.
        GmailMailboxPort.FetchResult again = new GmailMailbox(new GmailClient(mailboxOf(3)))
                .fetchNew(connection(), null, Instant.ofEpochMilli(BASE + 30_000), 10);
        assertEquals(List.of(id(3)), again.messages().stream().map(GmailMailboxPort.Message::id).toList());
    }

    @Test
    void twentyFiveMailsOverThreePollsAreAllAdmittedExactlyOnceInOrder() {
        GmailMailbox mailbox = new GmailMailbox(new GmailClient(mailboxOf(25)));
        Instant cursor = Instant.ofEpochMilli(BASE);
        Set<String> seen = new LinkedHashSet<>();
        List<String> order = new ArrayList<>();

        for (int poll = 0; poll < 3; poll++) {
            GmailMailboxPort.FetchResult result = mailbox.fetchNew(connection(), null, cursor, 10);
            assertTrue(result.messages().size() <= 10);
            for (GmailMailboxPort.Message message : result.messages()) {
                if (seen.add(message.id())) {
                    order.add(message.id());
                }
                cursor = message.internalDate().isAfter(cursor) ? message.internalDate() : cursor;
            }
        }

        assertEquals(25, order.size());
        List<String> expected = new ArrayList<>();
        for (int i = 1; i <= 25; i++) {
            expected.add(id(i));
        }
        assertEquals(expected, order);
    }

    @Test
    void moreThanOneHundredMatchesTakesTheNewestHundredAndRecordsTheTruncation() {
        FakeTransport transport = mailboxOf(130);

        GmailMailboxPort.FetchResult result = new GmailMailbox(new GmailClient(transport))
                .fetchNew(connection(), null, Instant.ofEpochMilli(BASE), 10);

        assertEquals("GMAIL_BACKLOG_TRUNCATED", result.notice());
        assertEquals(10, result.messages().size());
        // newest 100 are m31..m130; the oldest 10 of those are admitted first
        assertEquals(id(31), result.messages().getFirst().id());
        assertEquals(id(40), result.messages().getLast().id());
        assertEquals(1 + 10, transport.calls.size());
    }

    @Test
    void anOversizedMessageIsReadAsMetadataAndAdmittedWithTheBodyOmitted() {
        FakeTransport transport = new FakeTransport((uri, query) -> {
            if (uri.getPath().endsWith("/messages")) {
                return json(200, Map.of("messages", List.of(Map.of("id", id(1)))));
            }
            if ("full".equals(query.get("format"))) {
                throw new NodeExecutor.Failure("HTTP_RESPONSE_TOO_LARGE", "too large", false);
            }
            return json(200, Map.of("id", id(1), "internalDate", Long.toString(BASE), "snippet", "huge mail",
                    "payload", Map.of("headers", List.of(Map.of("name", "Subject", "value", "Big attachment")))));
        });

        GmailMailboxPort.FetchResult result = new GmailMailbox(new GmailClient(transport))
                .fetchNew(connection(), null, Instant.ofEpochMilli(BASE), 10);

        Map<String, Object> input = result.messages().getFirst().input();
        assertEquals(true, input.get("bodyOmitted"));
        assertEquals("", input.get("body"));
        assertEquals("Big attachment", input.get("subject"));
        assertEquals("huge mail", input.get("snippet"));
        assertEquals(null, result.notice());
        assertEquals("metadata", transport.calls.get(2).query().get("format"));
    }

    @Test
    void aMessageThatCannotBeReadIsSkippedWithANoticeAndTheRestIsStillAdmitted() {
        FakeTransport transport = new FakeTransport((uri, query) -> {
            if (uri.getPath().endsWith("/messages")) {
                return json(200, Map.of("messages", List.of(Map.of("id", id(2)), Map.of("id", id(1)))));
            }
            return uri.getPath().endsWith(id(2))
                    ? json(404, Map.of("error", "gone"))
                    : json(200, message(id(1), BASE, "kept"));
        });

        GmailMailboxPort.FetchResult result = new GmailMailbox(new GmailClient(transport))
                .fetchNew(connection(), null, Instant.ofEpochMilli(BASE), 10);

        assertEquals(List.of(id(1)), result.messages().stream().map(GmailMailboxPort.Message::id).toList());
        assertEquals("GMAIL_MESSAGE_SKIPPED", result.notice());
    }

    @Test
    void classifiesProviderFailuresWithStableCodes() {
        record Case(int status, Object body, String code, boolean retryable) {
        }
        Map<String, Object> quota = Map.of("error", Map.of("code", 403, "errors", List.of(Map.of("reason", "rateLimitExceeded"))));
        Map<String, Object> scope = Map.of("error", Map.of("code", 403, "status", "PERMISSION_DENIED",
                "errors", List.of(Map.of("reason", "insufficientPermissions"))));
        Map<String, Object> other = Map.of("error", Map.of("code", 403, "errors", List.of(Map.of("reason", "domainPolicy"))));
        for (Case c : List.of(new Case(401, Map.of(), "AUTHENTICATION_REJECTED", false),
                new Case(403, scope, "CONNECTION_RECONNECT_REQUIRED", false),
                new Case(403, quota, "HTTP_RATE_LIMITED", true),
                new Case(403, other, "HTTP_BUSINESS_REJECTED", false),
                new Case(429, Map.of(), "HTTP_RATE_LIMITED", true),
                new Case(503, Map.of(), "HTTP_DEPENDENCY_UNAVAILABLE", true),
                new Case(400, Map.of("error", "provider-secret-detail"), "HTTP_BUSINESS_REJECTED", false))) {
            GmailMailbox mailbox = new GmailMailbox(new GmailClient(
                    new FakeTransport((uri, query) -> json(c.status(), c.body()))));

            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> mailbox.fetchNew(connection(), null, Instant.ofEpochSecond(1), 10));

            assertEquals(c.code(), failure.code(), "status " + c.status() + " " + c.body());
            assertEquals(c.retryable(), failure.retryable(), "status " + c.status());
            assertTrue(!failure.getMessage().contains("provider-secret-detail"));
        }
    }

    @Test
    void anAuthenticationFailureWhileReadingAMessageIsNotSwallowed() {
        FakeTransport transport = new FakeTransport((uri, query) -> uri.getPath().endsWith("/messages")
                ? json(200, Map.of("messages", List.of(Map.of("id", id(1)))))
                : json(401, Map.of()));

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> new GmailMailbox(new GmailClient(transport))
                        .fetchNew(connection(), null, Instant.ofEpochSecond(1), 10));

        assertEquals("AUTHENTICATION_REJECTED", failure.code());
    }

    private static final class FakeTransport extends PinnedHttpTransport {
        record Call(URI uri, Map<String, Object> query, String token) {
        }

        final List<Call> calls = new ArrayList<>();
        private final BiFunction<URI, Map<String, Object>, HttpResponse> responder;

        FakeTransport(BiFunction<URI, Map<String, Object>, HttpResponse> responder) {
            super();
            this.responder = responder;
        }

        @Override
        @SuppressWarnings("unchecked")
        public HttpResponse executeGmailGetWithBearerToken(URI uri, Object query, String accessToken) {
            Map<String, Object> copy = new LinkedHashMap<>((Map<String, Object>) query);
            calls.add(new Call(uri, copy, accessToken));
            return responder.apply(uri, copy);
        }
    }
}
