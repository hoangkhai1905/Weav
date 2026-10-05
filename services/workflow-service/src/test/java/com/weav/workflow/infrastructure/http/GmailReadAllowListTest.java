package com.weav.workflow.infrastructure.http;

import com.weav.workflow.application.node.NodeExecutor;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** The Gmail read allow-list is exact: GET on the messages list or on one hex message id, nothing else. */
class GmailReadAllowListTest {

    private final PinnedHttpTransport transport = new PinnedHttpTransport();

    @Test
    void acceptsOnlyTheListAndOneMessageIdOnTheGmailHost() {
        for (String ok : List.of(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages",
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/18c0ffee00000001",
                "https://GMAIL.googleapis.com:443/gmail/v1/users/me/messages/ABCDEF0123")) {
            assertDoesNotThrow(() -> transport.validateGmailReadUri(URI.create(ok)), ok);
        }
    }

    @Test
    void rejectsEveryOtherShape() {
        for (String bad : List.of(
                "http://gmail.googleapis.com/gmail/v1/users/me/messages",
                "https://www.googleapis.com/gmail/v1/users/me/messages",
                "https://gmail.googleapis.com.evil.example/gmail/v1/users/me/messages",
                "https://gmail.googleapis.com:8443/gmail/v1/users/me/messages",
                "https://user@gmail.googleapis.com/gmail/v1/users/me/messages",
                "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=x",
                "https://gmail.googleapis.com/gmail/v1/users/me/messages#frag",
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/",
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/trash",
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/batchDelete",
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/abc123/trash",
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/abc123/attachments/x",
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/../drafts",
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/%2e%2e",
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/ab%2Fcd",
                "https://gmail.googleapis.com/gmail/v1/users/me/messages//abc123",
                "https://gmail.googleapis.com/gmail/v1/users/other@example.test/messages",
                "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + "a".repeat(33))) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> transport.validateGmailReadUri(URI.create(bad)), bad);
            assertEquals("HTTP_REQUEST_INVALID", failure.code(), bad);
        }
        assertThrows(NodeExecutor.Failure.class, () -> transport.validateGmailReadUri(null));
    }

    @Test
    void theReadMethodRejectsABadTokenBeforeAnyNetworkCall() {
        URI uri = URI.create("https://gmail.googleapis.com/gmail/v1/users/me/messages");

        for (String token : new String[] {null, " ", "bad\ntoken"}) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> transport.executeGmailGetWithBearerToken(uri, Map.of("q", "x"), token));
            assertEquals("HTTP_REQUEST_INVALID", failure.code());
        }
    }
}
