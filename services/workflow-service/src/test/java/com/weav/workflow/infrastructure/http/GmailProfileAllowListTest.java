package com.weav.workflow.infrastructure.http;

import com.weav.workflow.application.node.NodeExecutor;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** The Gmail profile call is exactly GET users/me/profile on the Gmail host. */
class GmailProfileAllowListTest {

    private final PinnedHttpTransport transport = new PinnedHttpTransport();

    @Test
    void acceptsOnlyTheFixedProfileUri() {
        assertDoesNotThrow(() -> transport.validateGmailProfileUri(
                URI.create("https://gmail.googleapis.com/gmail/v1/users/me/profile")));
        for (String bad : List.of(
                "http://gmail.googleapis.com/gmail/v1/users/me/profile",
                "https://www.googleapis.com/gmail/v1/users/me/profile",
                "https://gmail.googleapis.com:8443/gmail/v1/users/me/profile",
                "https://user@gmail.googleapis.com/gmail/v1/users/me/profile",
                "https://gmail.googleapis.com/gmail/v1/users/me/profile?x=1",
                "https://gmail.googleapis.com/gmail/v1/users/me/profile#f",
                "https://gmail.googleapis.com/gmail/v1/users/me/profile/",
                "https://gmail.googleapis.com/gmail/v1/users/other@example.test/profile",
                "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs")) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> transport.validateGmailProfileUri(URI.create(bad)), bad);
            assertEquals("HTTP_REQUEST_INVALID", failure.code(), bad);
        }
        assertThrows(NodeExecutor.Failure.class, () -> transport.validateGmailProfileUri(null));
    }

    @Test
    void theProfileMethodRejectsABadTokenBeforeAnyNetworkCall() {
        URI profile = URI.create("https://gmail.googleapis.com/gmail/v1/users/me/profile");
        assertThrows(NodeExecutor.Failure.class, () -> transport.executeGmailProfileGetWithBearerToken(profile, " "));
        assertThrows(NodeExecutor.Failure.class, () -> transport.executeGmailProfileGetWithBearerToken(
                URI.create("https://evil.example/gmail/v1/users/me/profile"), "token"));
    }
}
