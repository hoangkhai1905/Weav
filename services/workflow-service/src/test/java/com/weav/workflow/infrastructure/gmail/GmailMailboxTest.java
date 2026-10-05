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

    /** Fake Gmail that honours after: (second granularity, inclusive), lists newest first (ties by id desc). */
    private static final class Gmail {
        final Map<String, Long> internalDates = new LinkedHashMap<>();
        final Set<String> unreadable = new LinkedHashSet<>();

        Gmail add(String id, long internalDate) {
            internalDates.put(id, internalDate);
            return this;
        }

        FakeTransport transport() {
            return new FakeTransport((uri, query) -> {
                if (uri.getPath().endsWith("/messages")) {
                    long afterSec = Long.parseLong(((String) query.get("q")).replaceAll(".*after:", ""));
                    List<String> ids = new ArrayList<>(internalDates.keySet().stream()
                            .filter(id -> internalDates.get(id) / 1000 >= afterSec).toList());
                    ids.sort((x, y) -> {
                        int byDate = Long.compare(internalDates.get(y), internalDates.get(x));
                        return byDate != 0 ? byDate : y.compareTo(x);
                    });
                    int limit = Math.min(ids.size(), (Integer) query.get("maxResults"));
                    Map<String, Object> body = new LinkedHashMap<>();
                    body.put("messages", ids.subList(0, limit).stream().map(id -> Map.of("id", id)).toList());
                    if (limit < ids.size()) {
                        body.put("nextPageToken", "next-" + limit);
                    }
                    return json(200, body);
                }
                String id = uri.getPath().substring(uri.getPath().lastIndexOf('/') + 1);
                return unreadable.contains(id) ? json(404, Map.of("error", "gone"))
                        : json(200, message(id, internalDates.get(id), "body " + id));
            });
        }
    }

    /** What the trigger stores plus the loop of GmailTriggerProcessor, against a fake mailbox. */
    private static final class Trigger {
        final GmailMailbox mailbox;
        Instant cursor;
        String lastId;
        final List<String> admitted = new ArrayList<>();
        String lastNotice;

        Trigger(FakeTransport transport, Instant cursor) {
            this.mailbox = new GmailMailbox(new GmailClient(transport));
            this.cursor = cursor;
        }

        void poll() {
            GmailMailboxPort.FetchResult result = mailbox.fetchNew(connection(), null, cursor, lastId, 10);
            lastNotice = result.notice();
            for (GmailMailboxPort.Message message : result.messages()) {
                if (!message.isSkipMarker()) {
                    // the idempotency key makes a repeat harmless; count each id once like admission does
                    if (!admitted.contains(message.id())) {
                        admitted.add(message.id());
                    }
                    cursor = message.internalDate().isAfter(cursor) ? message.internalDate() : cursor;
                }
                lastId = message.id();
            }
        }
    }

    private static List<String> ids(int from, int to) {
        List<String> ids = new ArrayList<>();
        for (int i = from; i <= to; i++) {
            ids.add(id(i));
        }
        return ids;
    }

    @Test
    void listsWithTheSearchAndCursorThenReadsEachMessageAndReturnsThemOldestFirst() {
        Gmail gmail = new Gmail().add(id(1), BASE + 10_000).add(id(2), BASE + 20_000).add(id(3), BASE + 30_000);
        FakeTransport transport = gmail.transport();

        GmailMailboxPort.FetchResult result = new GmailMailbox(new GmailClient(transport)).fetchNew(
                connection(), "from:billing@example.test", Instant.ofEpochMilli(BASE), null, 10);

        assertEquals(ids(1, 3), result.messages().stream().map(GmailMailboxPort.Message::id).toList());
        assertEquals("body " + id(1), result.messages().getFirst().input().get("body"));
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
        FakeTransport transport = new Gmail().transport();

        GmailMailboxPort.FetchResult result = new GmailMailbox(new GmailClient(transport))
                .fetchNew(connection(), null, Instant.ofEpochSecond(42), null, 10);

        assertTrue(result.messages().isEmpty());
        assertEquals("after:41", transport.calls.getFirst().query().get("q"));
        assertEquals(1, transport.calls.size());
    }

    @Test
    void mailFromBeforeTheCursorBecomesASkipMarkerAndMailAtOrAfterItIsKept() {
        Gmail gmail = new Gmail().add(id(1), BASE + 10_000).add(id(2), BASE + 20_000).add(id(3), BASE + 30_000);
        Trigger trigger = new Trigger(gmail.transport(), Instant.ofEpochMilli(BASE + 25_000));

        trigger.poll();

        assertEquals(List.of(id(3)), trigger.admitted);
        assertEquals(id(3), trigger.lastId, "the position moved past the skipped mails too");
        trigger.poll();
        assertEquals(List.of(id(3)), trigger.admitted, "nothing new appears on the next poll");
    }

    @Test
    void fifteenMailsInOneSecondAreAllAdmittedOverTwoPolls() {
        Gmail gmail = new Gmail();
        for (int i = 1; i <= 15; i++) {
            gmail.add(id(i), BASE + 500 + i);
        }
        Trigger trigger = new Trigger(gmail.transport(), Instant.ofEpochMilli(BASE));

        trigger.poll();
        assertEquals(ids(1, 10), trigger.admitted);
        trigger.poll();

        assertEquals(ids(1, 15), trigger.admitted);
    }

    @Test
    void twentyFiveMailsInOneSecondAreAllAdmittedOverThreePollsExactlyOnceInOrder() {
        Gmail gmail = new Gmail();
        for (int i = 1; i <= 25; i++) {
            gmail.add(id(i), BASE + 100 + i);
        }
        Trigger trigger = new Trigger(gmail.transport(), Instant.ofEpochMilli(BASE));

        trigger.poll();
        trigger.poll();
        trigger.poll();

        assertEquals(ids(1, 25), trigger.admitted);
        trigger.poll();
        assertEquals(25, trigger.admitted.size());
        assertEquals(null, trigger.lastNotice);
    }

    @Test
    void tenUnreadableMailsDoNotBlockTheFiveReadableOnesInTheSameSecond() {
        Gmail gmail = new Gmail();
        for (int i = 1; i <= 15; i++) {
            gmail.add(id(i), BASE + 100 + i);
            if (i <= 10) {
                gmail.unreadable.add(id(i));
            }
        }
        Trigger trigger = new Trigger(gmail.transport(), Instant.ofEpochMilli(BASE));

        trigger.poll();
        assertTrue(trigger.admitted.isEmpty());
        assertEquals("GMAIL_MESSAGE_SKIPPED", trigger.lastNotice);
        assertEquals(id(10), trigger.lastId, "the unreadable mails were stepped over");
        trigger.poll();

        assertEquals(ids(11, 15), trigger.admitted);
        assertEquals(null, trigger.lastNotice, "a skipped mail is not skipped again, so the notice clears");
    }

    @Test
    void aResumeCursorInTheMiddleOfABurstAdmitsOnlyTheMailFromTheCursorOn() {
        Gmail gmail = new Gmail();
        for (int i = 1; i <= 15; i++) {
            gmail.add(id(i), BASE + 100 + i);
        }
        // resumed exactly at the timestamp of mail 7: mails 1..6 are older, 7 (equal) and later are kept
        Trigger trigger = new Trigger(gmail.transport(), Instant.ofEpochMilli(BASE + 107));

        trigger.poll();
        trigger.poll();

        assertEquals(ids(7, 15), trigger.admitted);
    }

    @Test
    void moreThanOneHundredMatchesTakesTheNewestHundredAndRecordsTheTruncation() {
        Gmail gmail = new Gmail();
        for (int i = 1; i <= 130; i++) {
            gmail.add(id(i), BASE + i * 10_000L);
        }
        FakeTransport transport = gmail.transport();

        GmailMailboxPort.FetchResult result = new GmailMailbox(new GmailClient(transport))
                .fetchNew(connection(), null, Instant.ofEpochMilli(BASE), null, 10);

        assertEquals("GMAIL_BACKLOG_TRUNCATED", result.notice());
        assertEquals(ids(31, 40), result.messages().stream().map(GmailMailboxPort.Message::id).toList());
        assertEquals(1 + 10, transport.calls.size(), "bounded Gmail calls per poll");
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
                .fetchNew(connection(), null, Instant.ofEpochMilli(BASE), null, 10);

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
                .fetchNew(connection(), null, Instant.ofEpochMilli(BASE), null, 10);

        assertEquals(2, result.messages().size());
        assertTrue(result.messages().getFirst().isSkipMarker() || result.messages().getLast().isSkipMarker());
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
                    () -> mailbox.fetchNew(connection(), null, Instant.ofEpochSecond(1), null, 10));

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
                        .fetchNew(connection(), null, Instant.ofEpochSecond(1), null, 10));

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
