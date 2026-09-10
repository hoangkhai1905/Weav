package com.weav.identity.application.validation;

import com.weav.identity.application.port.out.KeyedFingerprint;

import java.util.Objects;

/**
 * Domain-separated fingerprint namespaces used by the Google OAuth flow.
 *
 * <p>Keeping the namespace values in one application policy prevents the
 * coordinator and the provider adapter from accidentally authenticating the
 * same value under different HMAC domains.</p>
 */
public final class OAuthFingerprintPolicy {

    public static final String GOOGLE_STATE_NAMESPACE = "oauth-google-state";
    public static final String GOOGLE_NONCE_NAMESPACE = "oauth-google-nonce";
    public static final String GOOGLE_HANDOFF_NAMESPACE = "oauth-google-handoff";

    private OAuthFingerprintPolicy() {
    }

    public static String googleState(KeyedFingerprint fingerprint, String state) {
        return fingerprint(fingerprint, GOOGLE_STATE_NAMESPACE, state);
    }

    public static String googleNonce(KeyedFingerprint fingerprint, String nonce) {
        return fingerprint(fingerprint, GOOGLE_NONCE_NAMESPACE, nonce);
    }

    public static String googleHandoff(KeyedFingerprint fingerprint, String handoffCode) {
        return fingerprint(fingerprint, GOOGLE_HANDOFF_NAMESPACE, handoffCode);
    }

    private static String fingerprint(KeyedFingerprint fingerprint, String namespace, String value) {
        Objects.requireNonNull(fingerprint, "fingerprint must not be null");
        Objects.requireNonNull(value, "value must not be null");
        return fingerprint.fingerprint(namespace, value);
    }
}
