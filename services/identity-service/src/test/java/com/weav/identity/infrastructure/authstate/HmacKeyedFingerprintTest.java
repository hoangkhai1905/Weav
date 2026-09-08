package com.weav.identity.infrastructure.authstate;

import com.weav.identity.application.port.out.OtpChallengeStore;
import com.weav.identity.domain.exception.DependencyUnavailableException;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HmacKeyedFingerprintTest {

    private static final String SECRET = "test-otp-hmac-secret-01234567890123456789";

    @Test
    void fingerprintsAreStableAndNamespaceSeparated() {
        HmacKeyedFingerprint fingerprint = new HmacKeyedFingerprint(SECRET);

        assertEquals(fingerprint.fingerprint("code", "value"), fingerprint.fingerprint("code", "value"));
        assertNotEquals(fingerprint.fingerprint("code", "value"), fingerprint.fingerprint("grant", "value"));
        assertTrue(fingerprint.fingerprint("code", "value").matches("[A-Za-z0-9_-]{43}"));
    }

    @Test
    void missingOrWeakSecretFailsClosed() {
        assertThrows(DependencyUnavailableException.class,
                () -> new HmacKeyedFingerprint("short").fingerprint("code", "value"));
        assertThrows(DependencyUnavailableException.class,
                () -> new HmacKeyedFingerprint("                                ").fingerprint("code", "value"));
        assertThrows(DependencyUnavailableException.class,
                () -> new HmacKeyedFingerprint(null).fingerprint("code", "value"));
    }

    @Test
    void namespaceDelimiterCannotBeInjected() {
        HmacKeyedFingerprint fingerprint = new HmacKeyedFingerprint(SECRET);

        assertThrows(IllegalArgumentException.class,
                () -> fingerprint.fingerprint("code\u0000grant", "value"));
    }

    @Test
    void sensitiveOtpRecordsRedactFingerprintsAndTokens() {
        OtpChallengeStore.Challenge challenge = new OtpChallengeStore.Challenge(
                "challenge", OtpChallengeStore.Purpose.PASSWORD_RESET, "account", "user",
                "code-fingerprint", "credential-fingerprint", Duration.ofMinutes(5));

        String text = challenge.toString();
        assertTrue(text.contains("<redacted>"));
        assertTrue(!text.contains("code-fingerprint"));
        assertTrue(!text.contains("credential-fingerprint"));
    }
}
