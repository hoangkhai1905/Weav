package com.weav.identity.application.validation;

import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OtpChallengeStore;

import java.util.Objects;

/** Domain-separated keyed fingerprints for all short-lived OTP state. */
public final class OtpFingerprintPolicy {

    private static final String ACCOUNT_NAMESPACE = "otp-account";
    private static final String IP_NAMESPACE = "otp-ip";
    private static final String CODE_NAMESPACE = "otp-code";
    private static final String CREDENTIAL_NAMESPACE = "otp-credential";
    private static final String NULL_CREDENTIAL = "<null-credential>";

    private OtpFingerprintPolicy() {
    }

    public static String account(KeyedFingerprint fingerprint, String canonicalEmail) {
        return fingerprint.fingerprint(ACCOUNT_NAMESPACE, Objects.requireNonNull(canonicalEmail));
    }

    public static String remoteIp(KeyedFingerprint fingerprint, String remoteIp) {
        return fingerprint.fingerprint(IP_NAMESPACE, Objects.requireNonNull(remoteIp));
    }

    public static String credential(KeyedFingerprint fingerprint, String passwordHash) {
        return fingerprint.fingerprint(CREDENTIAL_NAMESPACE,
                passwordHash == null || passwordHash.isBlank() ? NULL_CREDENTIAL : passwordHash);
    }

    public static String code(
            KeyedFingerprint fingerprint,
            String challengeId,
            OtpChallengeStore.Purpose purpose,
            String userId,
            String accountFingerprint,
            String code
    ) {
        String binding = String.join("\u0000", challengeId, purpose.name(), userId, accountFingerprint, code);
        return fingerprint.fingerprint(CODE_NAMESPACE, binding);
    }
}
