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
    private static final java.util.UUID WS = java.util.UUID.fromString("00000000-0000-0000-0000-0000000000a1");

    private static GmailMailbox mailbox(FakeTransport transport) {
        return mailbox(transport, new FakeStore());
    }

    private static GmailMailbox mailbox(FakeTransport transport, FakeStore store) {
        return mailbox(transport, store, java.time.Clock.fixed(Instant.ofEpochMilli(BASE + 60_000), java.time.ZoneOffset.UTC));
    }

    private static GmailMailbox mailbox(FakeTransport transport, FakeStore store, java.time.Clock clock) {
        GmailClient client = new GmailClient(transport);
        return new GmailMailbox(client, new GmailAttachmentReader(client, transport), store,
                new com.weav.workflow.infrastructure.files.WorkflowFileProperties(), clock);
    }

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
        final Map<String, List<Map<String, Object>>> attachmentParts = new LinkedHashMap<>();

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
                        : json(200, withParts(message(id, internalDates.get(id), "body " + id), attachmentParts.get(id)));
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
            this.mailbox = mailbox(transport);
            this.cursor = cursor;
        }

        void poll() {
            GmailMailboxPort.FetchResult result = mailbox.fetchNew(WS, connection(), null, cursor, lastId, 10);
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

        GmailMailboxPort.FetchResult result = mailbox(transport).fetchNew(WS, connection(), "from:billing@example.test", Instant.ofEpochMilli(BASE), null, 10);

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

        GmailMailboxPort.FetchResult result = mailbox(transport)
                .fetchNew(WS, connection(), null, Instant.ofEpochSecond(42), null, 10);

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

        GmailMailboxPort.FetchResult result = mailbox(transport)
                .fetchNew(WS, connection(), null, Instant.ofEpochMilli(BASE), null, 10);

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

        GmailMailboxPort.FetchResult result = mailbox(transport)
                .fetchNew(WS, connection(), null, Instant.ofEpochMilli(BASE), null, 10);

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

        GmailMailboxPort.FetchResult result = mailbox(transport)
                .fetchNew(WS, connection(), null, Instant.ofEpochMilli(BASE), null, 10);

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
            GmailMailbox mailbox = mailbox(new FakeTransport((uri, query) -> json(c.status(), c.body())));

            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> mailbox.fetchNew(WS, connection(), null, Instant.ofEpochSecond(1), null, 10));

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
                () -> mailbox(transport)
                        .fetchNew(WS, connection(), null, Instant.ofEpochSecond(1), null, 10));

        assertEquals("AUTHENTICATION_REJECTED", failure.code());
    }

    // ---- attachments ----
    private static final Instant RECENT = Instant.ofEpochMilli(BASE + 60_000);
    private static final Instant OLD = Instant.ofEpochMilli(BASE + 3 * 3_600_000L);

    private static GmailMailboxPort.FetchResult fetchMany(
            Instant now, FakeStore store, int count, java.util.Set<Integer> withAttachment, long declaredSize,
            java.util.function.Function<URI, PinnedHttpTransport.HttpResponse> download) {
        Gmail gmail = new Gmail();
        for (int i = 1; i <= count; i++) {
            gmail.add(id(i), BASE + i * 10_000L);
            if (withAttachment.contains(i)) {
                gmail.attachmentParts.put(id(i), List.of(attachmentPart("a" + i + ".bin", "application/pdf", "AID" + i, declaredSize),
                        attachmentPart("b" + i + ".bin", "application/pdf", "BID" + i, declaredSize),
                        attachmentPart("c" + i + ".bin", "application/pdf", "CID" + i, declaredSize)));
            }
        }
        FakeTransport transport = gmail.transport();
        transport.attachmentResponder = download;
        return mailbox(transport, store, java.time.Clock.fixed(now, java.time.ZoneOffset.UTC))
                .fetchNew(WS, connection(), null, Instant.ofEpochMilli(BASE), null, 10);
    }

    private static PinnedHttpTransport.HttpResponse failing(String code) {
        throw new NodeExecutor.Failure(code, "down", true);
    }

    @Test
    void aPersistentRetryableFailureOnTheFirstRecentMessageFailsThePollButAnOldOneIsAdmittedWithErrorMarkers() {
        for (java.util.function.Function<URI, PinnedHttpTransport.HttpResponse> broken : List.<java.util.function.Function<URI, PinnedHttpTransport.HttpResponse>>of(
                uri -> json(503, Map.of()), uri -> failing("HTTP_TIMEOUT"))) {
            assertThrows(NodeExecutor.Failure.class,
                    () -> fetchMany(RECENT, new FakeStore(), 1, java.util.Set.of(1), 5, broken));

            var old = fetchMany(OLD, new FakeStore(), 1, java.util.Set.of(1), 5, broken);

            assertEquals(1, old.messages().size());
            assertTrue(attachmentsOf(old).stream().allMatch(item -> "error".equals(item.get("skipped"))));
        }
        FakeStore unavailable = new FakeStore();
        unavailable.failure = new NodeExecutor.Failure("FILE_STORE_UNAVAILABLE", "down", true);
        assertThrows(NodeExecutor.Failure.class,
                () -> fetchMany(RECENT, unavailable, 1, java.util.Set.of(1), 5, uri -> attachmentJson("x")));
        assertEquals("error", attachmentsOf(fetchMany(OLD, unavailable, 1, java.util.Set.of(1), 5,
                uri -> attachmentJson("x"))).getFirst().get("skipped"));
    }

    @Test
    void aRetryableFailureOnALaterMessageReturnsTheEarlierOnesAndLeavesTheFailingOneForTheNextPoll() {
        var result = fetchMany(RECENT, new FakeStore(), 3, java.util.Set.of(3), 5, uri -> json(503, Map.of()));

        assertEquals(List.of(id(1), id(2)), result.messages().stream().map(GmailMailboxPort.Message::id).toList());
    }

    @Test
    void credentialFailuresStillFailThePollEvenForLaterMessagesAndOldMail() {
        for (Instant now : List.of(RECENT, OLD)) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> fetchMany(now, new FakeStore(), 3, java.util.Set.of(3), 5, uri -> json(401, Map.of())));
            assertEquals("AUTHENTICATION_REJECTED", failure.code());
        }
    }

    @Test
    void thePollStopsBeforeAMessageThatWouldPushDownloadsOverTheBudgetButNeverBeforeTheFirst() {
        // 3 declared 10 MiB attachments per message = 30 MiB; budget is 40 MiB
        var result = fetchMany(RECENT, new FakeStore(), 3, java.util.Set.of(1, 2, 3), 10L * 1024 * 1024,
                uri -> attachmentJson("x"));

        assertEquals(List.of(id(1)), result.messages().stream().map(GmailMailboxPort.Message::id).toList());
        assertTrue(attachmentsOf(result).stream().noneMatch(item -> item.containsKey("skipped")));
    }

    @Test
    void aFutureDatedMessageWithAFailingAttachmentIsDegradedAndAdmittedNotStalled() {
        Instant farBefore = Instant.ofEpochMilli(BASE - 86_400_000L); // the mail is a day ahead of "now"

        var result = fetchMany(farBefore, new FakeStore(), 1, java.util.Set.of(1), 5, uri -> json(503, Map.of()));

        assertEquals(1, result.messages().size());
        assertTrue(attachmentsOf(result).stream().allMatch(item -> "error".equals(item.get("skipped"))));
    }

    @Test
    void aRetryableFailureAfterOnlySkipMarkersReturnsJustTheMarkersAndSignalsMore() {
        Gmail gmail = new Gmail().add(id(1), BASE + 14_500).add(id(2), BASE + 20_000);
        gmail.attachmentParts.put(id(2), List.of(attachmentPart("a.bin", "application/pdf", "AID", 5)));
        FakeTransport transport = gmail.transport();
        transport.attachmentResponder = uri -> json(503, Map.of());

        var result = mailbox(transport, new FakeStore()).fetchNew(WS, connection(), null,
                Instant.ofEpochMilli(BASE + 15_000), null, 10); // m1 is older than the cursor: a skip marker

        assertEquals(List.of(id(1)), result.messages().stream().map(GmailMailboxPort.Message::id).toList());
        assertTrue(result.messages().getFirst().isSkipMarker());
        assertTrue(result.more());
    }

    @Test
    void aSliceCutByTheBudgetOrByARetryableFailureIsFlaggedMoreAndACompleteOneIsNot() {
        var budget = fetchMany(RECENT, new FakeStore(), 3, java.util.Set.of(1, 2, 3), 10L * 1024 * 1024,
                uri -> attachmentJson("x"));
        var retry = fetchMany(RECENT, new FakeStore(), 3, java.util.Set.of(3), 5, uri -> json(503, Map.of()));
        var complete = fetchMany(RECENT, new FakeStore(), 3, java.util.Set.of(), 5, uri -> attachmentJson("x"));

        assertTrue(budget.more());
        assertTrue(retry.more());
        assertTrue(!complete.more());
    }

    @Test
    void aBadMessageIdNeverEscapesAsAnException() {
        GmailClient client = new GmailClient(new FakeTransport((uri, q) -> json(200, Map.of())));
        GmailAttachmentReader reader = new GmailAttachmentReader(client, new FakeTransport((uri, q) -> json(200, Map.of())));

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> reader.read("not hex/../", "AID", 100, connection()));

        assertEquals("GMAIL_ATTACHMENT_UNREADABLE", failure.code());
    }


    private static String b64(String text) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(text.getBytes(StandardCharsets.UTF_8));
    }

    private static PinnedHttpTransport.HttpResponse attachmentJson(String text) {
        return json(200, Map.of("data", b64(text), "size", text.length()));
    }

    /** One message at BASE+10s carrying {@code parts}; the poll starts at {@code cursor}. */
    private static GmailMailboxPort.FetchResult fetchWith(
            FakeTransport[] transportOut, FakeStore store, Instant cursor, List<Map<String, Object>> parts,
            java.util.function.Function<URI, PinnedHttpTransport.HttpResponse> download) {
        Gmail gmail = new Gmail().add(id(1), BASE + 10_000);
        if (parts != null) {
            gmail.attachmentParts.put(id(1), parts);
        }
        FakeTransport transport = gmail.transport();
        transport.attachmentResponder = download;
        transportOut[0] = transport;
        return mailbox(transport, store).fetchNew(WS, connection(), null, cursor, null, 10);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> attachmentsOf(GmailMailboxPort.FetchResult result) {
        return (List<Map<String, Object>>) result.messages().getFirst().input().get("attachments");
    }

    @Test
    void anAttachmentIsDownloadedStoredWithTheWorkspaceAndNoExecutionAndListedAsAReferenceOnly() {
        FakeTransport[] t = new FakeTransport[1];
        FakeStore store = new FakeStore();

        var result = fetchWith(t, store, Instant.ofEpochMilli(BASE),
                List.of(attachmentPart("a.txt", "text/plain", "AID_1-x", 5)), uri -> attachmentJson("hello"));

        assertEquals(1, store.stored.size());
        assertEquals(WS, store.stored.getFirst().workspaceId());
        assertEquals(null, store.stored.getFirst().executionId());
        assertEquals("a.txt", store.stored.getFirst().filename());
        assertEquals("text/plain", store.stored.getFirst().mimeType());
        assertEquals("hello", new String(store.stored.getFirst().bytes(), StandardCharsets.UTF_8));
        assertEquals(List.of(Map.of("filename", "a.txt", "mimeType", "text/plain", "size", 5L, "fileId", "file-1")),
                attachmentsOf(result));
        assertEquals("https://gmail.googleapis.com/gmail/v1/users/me/messages/" + id(1) + "/attachments/AID_1-x",
                t[0].attachmentCalls.getFirst().uri().toString());
        assertEquals(TOKEN, t[0].attachmentCalls.getFirst().token());
        String input = result.messages().getFirst().input().toString();
        assertTrue(!input.contains("hello") && !input.contains(b64("hello")), "file bytes never enter the trigger input");
    }

    @Test
    void theDownloadCapFollowsTheFileLimitAndStaysUnderTheTransportCeiling() {
        FakeTransport[] t = new FakeTransport[1];

        fetchWith(t, new FakeStore(), Instant.ofEpochMilli(BASE),
                List.of(attachmentPart("a.bin", "application/pdf", "AID", 1000)), uri -> attachmentJson("x"));

        long max = new com.weav.workflow.infrastructure.files.WorkflowFileProperties().getMaxFileBytes();
        assertTrue(t[0].lastAttachmentCap >= max / 3 * 4);
        assertTrue(t[0].lastAttachmentCap <= PinnedHttpTransport.MAX_CALL_BYTES);
    }

    @Test
    void attachmentsBeyondTheCountLimitAreListedAsLimitWithoutDownloading() {
        FakeTransport[] t = new FakeTransport[1];
        FakeStore store = new FakeStore();
        List<Map<String, Object>> parts = new ArrayList<>();
        for (int i = 0; i < 7; i++) {
            parts.add(attachmentPart("f" + i + ".txt", "text/plain", "AID" + i, 1));
        }

        var result = fetchWith(t, store, Instant.ofEpochMilli(BASE), parts, uri -> attachmentJson("x"));

        List<Map<String, Object>> list = attachmentsOf(result);
        assertEquals(7, list.size());
        assertEquals(5, store.stored.size());
        assertEquals(5, t[0].attachmentCalls.size());
        assertEquals("limit", list.get(5).get("skipped"));
        assertEquals("limit", list.get(6).get("skipped"));
        assertTrue(!list.get(5).containsKey("fileId"));
        assertEquals("file-5", list.get(4).get("fileId"));
    }

    @Test
    void anAttachmentDeclaredLargerThanTheFileLimitIsNotDownloaded() {
        FakeTransport[] t = new FakeTransport[1];
        FakeStore store = new FakeStore();

        var result = fetchWith(t, store, Instant.ofEpochMilli(BASE),
                List.of(attachmentPart("big.zip", "application/zip", "AID", 10L * 1024 * 1024 + 1),
                        attachmentPart("ok.txt", "text/plain", "AID2", 2)), uri -> attachmentJson("ok"));

        assertEquals("too_large", attachmentsOf(result).get(0).get("skipped"));
        assertEquals("file-1", attachmentsOf(result).get(1).get("fileId"));
        assertEquals(1, t[0].attachmentCalls.size());
        assertTrue(t[0].attachmentCalls.getFirst().uri().toString().endsWith("/AID2"));
    }

    @Test
    void withoutAConfiguredStoreTheMetadataIsListedAndThePollContinues() {
        FakeTransport[] t = new FakeTransport[1];
        FakeStore store = new FakeStore();
        store.configured = false;

        var result = fetchWith(t, store, Instant.ofEpochMilli(BASE),
                List.of(attachmentPart("a.txt", "text/plain", "AID", 5)), uri -> attachmentJson("hello"));

        assertEquals(1, result.messages().size());
        assertEquals("not_stored", attachmentsOf(result).getFirst().get("skipped"));
        assertEquals(0, t[0].attachmentCalls.size());
        assertEquals(null, result.notice());
    }

    @Test
    void aPermanentlyUnreadableAttachmentIsListedAsErrorAndTheMessageAndOtherFilesSurvive() {
        FakeTransport[] t = new FakeTransport[1];
        FakeStore store = new FakeStore();

        var result = fetchWith(t, store, Instant.ofEpochMilli(BASE),
                List.of(attachmentPart("gone.txt", "text/plain", "BAD", 5),
                        attachmentPart("bad64.txt", "text/plain", "BAD64", 5),
                        attachmentPart("ok.txt", "text/plain", "OK", 2)),
                uri -> uri.toString().endsWith("/BAD") ? json(404, Map.of("error", "gone"))
                        : uri.toString().endsWith("/BAD64") ? json(200, Map.of("data", "@@@not base64@@@"))
                        : attachmentJson("ok"));

        List<Map<String, Object>> list = attachmentsOf(result);
        assertEquals("error", list.get(0).get("skipped"));
        assertEquals("error", list.get(1).get("skipped"));
        assertEquals("file-1", list.get(2).get("fileId"));
        assertEquals(1, result.messages().size());
    }

    @Test
    void aDownloadedFileLargerThanDeclaredIsTooLarge() {
        long max = new com.weav.workflow.infrastructure.files.WorkflowFileProperties().getMaxFileBytes();
        String huge = "x".repeat((int) max + 1);

        var result = fetchWith(new FakeTransport[1], new FakeStore(), Instant.ofEpochMilli(BASE),
                List.of(attachmentPart("liar.bin", "application/pdf", "AID", 3)), uri -> attachmentJson(huge));

        assertEquals("too_large", attachmentsOf(result).getFirst().get("skipped"));
    }

    @Test
    void retryableAndCredentialFailuresOnARecentFirstMessageFailThePoll() {
        for (var response : List.of(json(503, Map.of()), json(429, Map.of()), json(401, Map.of()))) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> fetchWith(new FakeTransport[1], new FakeStore(), Instant.ofEpochMilli(BASE),
                            List.of(attachmentPart("a.txt", "text/plain", "AID", 5)), uri -> response));
            assertTrue(failure.retryable() || "AUTHENTICATION_REJECTED".equals(failure.code()), failure.code());
        }
        FakeStore unavailable = new FakeStore();
        unavailable.failure = new NodeExecutor.Failure("FILE_STORE_UNAVAILABLE", "down", true);
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> fetchWith(new FakeTransport[1], unavailable, Instant.ofEpochMilli(BASE),
                        List.of(attachmentPart("a.txt", "text/plain", "AID", 5)), uri -> attachmentJson("hello")));
        assertEquals("FILE_STORE_UNAVAILABLE", failure.code());
    }

    @Test
    void aStoreRefusalForSizeIsTooLargeNotAFailure() {
        FakeStore store = new FakeStore();
        store.failure = new NodeExecutor.Failure("FILE_TOO_LARGE", "big", false);

        var result = fetchWith(new FakeTransport[1], store, Instant.ofEpochMilli(BASE),
                List.of(attachmentPart("a.txt", "text/plain", "AID", 5)), uri -> attachmentJson("hello"));

        assertEquals("too_large", attachmentsOf(result).getFirst().get("skipped"));
    }

    @Test
    void skipMarkersAndOldMailDownloadAndStoreNothing() {
        FakeTransport[] t = new FakeTransport[1];
        FakeStore store = new FakeStore();

        var result = fetchWith(t, store, Instant.ofEpochMilli(BASE + 50_000),
                List.of(attachmentPart("a.txt", "text/plain", "AID", 5)), uri -> attachmentJson("hello"));

        assertTrue(result.messages().stream().allMatch(GmailMailboxPort.Message::isSkipMarker));
        assertEquals(0, t[0].attachmentCalls.size());
        assertEquals(0, store.stored.size());
    }

    @Test
    void inlineAttachmentDataIsStoredWithoutADownloadAndAMessageWithoutAttachmentsListsNone() {
        FakeTransport[] t = new FakeTransport[1];
        FakeStore store = new FakeStore();
        Map<String, Object> inline = Map.of("mimeType", "text/csv", "filename", "tiny.csv",
                "body", Map.of("data", b64("a,b"), "size", 3));

        var result = fetchWith(t, store, Instant.ofEpochMilli(BASE), List.of(inline), uri -> attachmentJson("nope"));

        assertEquals("a,b", new String(store.stored.getFirst().bytes(), StandardCharsets.UTF_8));
        assertEquals(0, t[0].attachmentCalls.size());
        assertEquals("file-1", attachmentsOf(result).getFirst().get("fileId"));

        var none = fetchWith(new FakeTransport[1], store, Instant.ofEpochMilli(BASE), null, uri -> attachmentJson("x"));
        assertEquals(List.of(), attachmentsOf(none));
    }

    private static Map<String, Object> withParts(Map<String, Object> message, List<Map<String, Object>> parts) {
        if (parts == null) {
            return message;
        }
        Map<String, Object> copy = new LinkedHashMap<>(message);
        List<Object> all = new ArrayList<>();
        all.add(((Map<?, ?>) message.get("payload")));
        all.addAll(parts);
        copy.put("payload", Map.of("mimeType", "multipart/mixed", "filename", "", "parts", all));
        return copy;
    }

    private static Map<String, Object> attachmentPart(String filename, String mime, Object attachmentId, long size) {
        return Map.of("mimeType", mime, "filename", filename, "body", Map.of("attachmentId", attachmentId, "size", size));
    }

    /** Records stores; fails or reports not configured on demand. */
    private static final class FakeStore implements com.weav.workflow.application.port.out.WorkflowFileStore {
        record Stored(java.util.UUID workspaceId, java.util.UUID executionId, String filename, String mimeType, byte[] bytes) {
        }

        boolean configured = true;
        NodeExecutor.Failure failure;
        final List<Stored> stored = new ArrayList<>();

        public boolean configured() {
            return configured;
        }

        public FileReference store(java.util.UUID workspaceId, java.util.UUID executionId, String filename,
                                   String mimeType, byte[] bytes) {
            if (failure != null) {
                throw failure;
            }
            stored.add(new Stored(workspaceId, executionId, filename, mimeType, bytes));
            return new FileReference("file-" + stored.size(), filename, mimeType, bytes.length);
        }

        public StoredFile read(java.util.UUID workspaceId, String fileId) {
            throw new UnsupportedOperationException();
        }

        public int purgeExpired(int limit) {
            return 0;
        }
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

        final List<Call> attachmentCalls = new ArrayList<>();
        java.util.function.Function<URI, HttpResponse> attachmentResponder = uri -> json(404, Map.of());
        int lastAttachmentCap;

        @Override
        public HttpResponse executeGmailAttachmentGetWithBearerToken(URI uri, String accessToken, int maxResponseBytes) {
            attachmentCalls.add(new Call(uri, Map.of(), accessToken));
            lastAttachmentCap = maxResponseBytes;
            return attachmentResponder.apply(uri);
        }
    }
}
