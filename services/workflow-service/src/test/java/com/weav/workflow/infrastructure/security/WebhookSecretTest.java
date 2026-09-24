package com.weav.workflow.infrastructure.security;

import com.weav.workflow.application.port.out.WebhookSecretPort;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WebhookSecretTest {
    private static final Pattern ENDPOINT_KEY = Pattern.compile("[A-Za-z0-9_-]{32}");
    private static final Pattern SECRET = Pattern.compile("[A-Za-z0-9_-]{43}");

    private final WebhookSecretService secrets = new WebhookSecretService();

    @Test
    void issuesIndependentRandomEndpointAndSecretAndStoresOnlyTheSecretDigest() throws Exception {
        WebhookSecretPort.IssuedKey first = secrets.provision();
        WebhookSecretPort.IssuedKey second = secrets.provision();

        assertTrue(ENDPOINT_KEY.matcher(first.endpointKey()).matches());
        assertTrue(SECRET.matcher(first.secret()).matches());
        assertTrue(first.secretHash().matches("[0-9a-f]{64}"));
        assertNotEquals(first.endpointKey(), first.secret());
        assertNotEquals(first.endpointKey(), second.endpointKey());
        assertNotEquals(first.secret(), second.secret());
        assertNotEquals(first.secret(), first.secretHash());
        assertTrue(secrets.matches(first.secret(), first.secretHash()));
        assertFalse(secrets.matches("wrong-secret", first.secretHash()));
        assertFalse(secrets.matches(null, first.secretHash()));
        assertFalse(secrets.matches(first.secret(), WebhookSecretPort.UNKNOWN_HASH));

        String expectedHash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(first.secret().getBytes(StandardCharsets.UTF_8)));
        assertEquals(expectedHash, first.secretHash());
        assertFalse(first.toString().contains(first.endpointKey()));
        assertFalse(first.toString().contains(first.secret()));
        assertFalse(first.toString().contains(first.secretHash()));
    }
}
