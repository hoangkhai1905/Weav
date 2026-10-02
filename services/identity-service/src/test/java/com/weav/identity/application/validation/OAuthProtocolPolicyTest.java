package com.weav.identity.application.validation;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OAuthProtocolPolicyTest {

    private static final String VALID_VERIFIER = "aB0-._~".repeat(7);

    @Test
    void derivesTheRequiredUnpaddedS256Challenge() {
        String challenge = OAuthProtocolPolicy.challengeForVerifier(VALID_VERIFIER);

        assertEquals(43, challenge.length());
        assertTrue(challenge.matches("[A-Za-z0-9_-]{43}"));
        assertEquals(challenge, OAuthProtocolPolicy.challengeForVerifier(VALID_VERIFIER));
    }

    @Test
    void acceptsVerifierBoundsAndAllRfc7636UnreservedCharacters() {
        assertEquals(VALID_VERIFIER, OAuthProtocolPolicy.requireVerifier(VALID_VERIFIER));
        assertEquals("a".repeat(128), OAuthProtocolPolicy.requireVerifier("a".repeat(128)));
    }

    @Test
    void rejectsInvalidChallengeMethodAndChallengeEncoding() {
        assertThrows(IllegalArgumentException.class,
                () -> OAuthProtocolPolicy.requireS256Method("plain"));
        assertThrows(IllegalArgumentException.class,
                () -> OAuthProtocolPolicy.requireS256Challenge("a".repeat(42)));
        assertThrows(IllegalArgumentException.class,
                () -> OAuthProtocolPolicy.requireS256Challenge("a".repeat(42) + "="));
        assertThrows(IllegalArgumentException.class,
                () -> OAuthProtocolPolicy.requireS256Challenge("a".repeat(42) + "/"));
    }

    @Test
    void rejectsVerifierOutsideLengthOrUnreservedAsciiBounds() {
        assertThrows(IllegalArgumentException.class,
                () -> OAuthProtocolPolicy.requireVerifier("a".repeat(42)));
        assertThrows(IllegalArgumentException.class,
                () -> OAuthProtocolPolicy.requireVerifier("a".repeat(129)));
        assertThrows(IllegalArgumentException.class,
                () -> OAuthProtocolPolicy.requireVerifier("a".repeat(42) + " "));
        assertThrows(IllegalArgumentException.class,
                () -> OAuthProtocolPolicy.requireVerifier("a".repeat(42) + "/"));
        assertThrows(IllegalArgumentException.class,
                () -> OAuthProtocolPolicy.requireVerifier("a".repeat(42) + "é"));
    }

    @Test
    void recognizesOnlyDnsStyleHostedDomains() {
        assertTrue(OAuthProtocolPolicy.isValidHostedDomain("acme.example"));
        assertTrue(OAuthProtocolPolicy.isValidHostedDomain("sub.acme.example"));

        assertFalse(OAuthProtocolPolicy.isValidHostedDomain(null));
        assertFalse(OAuthProtocolPolicy.isValidHostedDomain("not a domain"));
        assertFalse(OAuthProtocolPolicy.isValidHostedDomain("https://evil.example"));
        assertFalse(OAuthProtocolPolicy.isValidHostedDomain("a..b"));
        assertFalse(OAuthProtocolPolicy.isValidHostedDomain("-acme.example"));
        assertFalse(OAuthProtocolPolicy.isValidHostedDomain("acme-.example"));
    }
}
