package com.weav.identity.application.port.out;

import java.time.Duration;
import java.util.Objects;

/**
 * Framework-free boundary for short-lived OTP challenges, reset grants and
 * admission counters. Implementations must make the consume operations
 * atomic and must never persist an OTP or grant in plaintext.
 */
public interface OtpChallengeStore {

    /** Generates an opaque random identifier; it carries no account identity. */
    String newChallengeId();

    ChallengeReceipt issue(Challenge challenge);

    ChallengeMetadata lookup(String challengeId);

    VerificationResult verify(VerificationAttempt attempt);

    GrantConsumptionResult consumeGrant(String grantToken);

    void invalidate(Challenge challenge);

    /**
     * Atomically supersedes the active challenge and reset grant for an account
     * and purpose. Used for accepted recovery requests that must not reveal
     * whether an eligible account exists.
     */
    void invalidatePurpose(String accountFingerprint, Purpose purpose);

    AdmissionResult reserve(String scope, String key, int limit, Duration window);

    record Challenge(
            String challengeId,
            Purpose purpose,
            String accountFingerprint,
            String userId,
            String codeFingerprint,
            String credentialFingerprint,
            Duration ttl
    ) {
        public Challenge {
            requireText(challengeId, "challengeId");
            Objects.requireNonNull(purpose, "purpose must not be null");
            requireText(accountFingerprint, "accountFingerprint");
            requireText(userId, "userId");
            requireText(codeFingerprint, "codeFingerprint");
            if (purpose == Purpose.PASSWORD_RESET) requireText(credentialFingerprint, "credentialFingerprint");
            Objects.requireNonNull(ttl, "ttl must not be null");
            if (ttl.isZero() || ttl.isNegative()) {
                throw new IllegalArgumentException("ttl must be positive");
            }
        }

        @Override
        public String toString() {
            return "Challenge[challengeId=<redacted>, purpose=" + purpose + ", accountFingerprint=<redacted>, userId=<redacted>, codeFingerprint=<redacted>, credentialFingerprint=<redacted>, ttl=" + ttl + "]";
        }
    }

    record VerificationAttempt(String challengeId, String codeFingerprint, int maxAttempts, Duration grantTtl) {
        public VerificationAttempt {
            requireText(challengeId, "challengeId");
            requireText(codeFingerprint, "codeFingerprint");
            if (maxAttempts < 1) throw new IllegalArgumentException("maxAttempts must be positive");
            if (grantTtl != null && (grantTtl.isZero() || grantTtl.isNegative())) {
                throw new IllegalArgumentException("grantTtl must be positive when supplied");
            }
        }

        @Override
        public String toString() {
            return "VerificationAttempt[challengeId=<redacted>, codeFingerprint=<redacted>, maxAttempts=" + maxAttempts + ", grantTtl=" + grantTtl + "]";
        }
    }

    record ChallengeMetadata(
            String challengeId,
            String accountFingerprint,
            Purpose purpose,
            String userId,
            String credentialFingerprint
    ) {
        public ChallengeMetadata {
            requireText(challengeId, "challengeId");
            requireText(accountFingerprint, "accountFingerprint");
            Objects.requireNonNull(purpose, "purpose must not be null");
            requireText(userId, "userId");
        }

        @Override
        public String toString() {
            return "ChallengeMetadata[challengeId=<redacted>, accountFingerprint=<redacted>, purpose=" + purpose + ", userId=<redacted>, credentialFingerprint=<redacted>]";
        }
    }

    record GrantConsumptionResult(boolean consumed, String accountFingerprint, Purpose purpose, String userId, String credentialFingerprint) {
        public GrantConsumptionResult {
            if (!consumed && (accountFingerprint != null || purpose != null || userId != null || credentialFingerprint != null)) {
                throw new IllegalArgumentException("unconsumed grant must not expose bindings");
            }
        }

        @Override
        public String toString() {
            return "GrantConsumptionResult[consumed=" + consumed + ", accountFingerprint=<redacted>, purpose=" + purpose + ", userId=<redacted>, credentialFingerprint=<redacted>]";
        }
    }

    record VerificationResult(
            Status status,
            Purpose purpose,
            String userId,
            String credentialFingerprint,
            String grantToken,
            long retryAfterSeconds
    ) {
        public VerificationResult {
            Objects.requireNonNull(status, "status must not be null");
            if (retryAfterSeconds < 0) throw new IllegalArgumentException("retryAfterSeconds must not be negative");
        }

        public VerificationResult(Status status, long retryAfterSeconds) {
            this(status, null, null, null, null, retryAfterSeconds);
        }

        public boolean verified() {
            return status == Status.VERIFIED;
        }

        @Override
        public String toString() {
            return "VerificationResult[status=" + status + ", purpose=" + purpose + ", userId=<redacted>, credentialFingerprint=<redacted>, grantToken=<redacted>, retryAfterSeconds=" + retryAfterSeconds + "]";
        }
    }

    record ChallengeReceipt(boolean accepted, boolean replaced, long expiresInSeconds) {
        public ChallengeReceipt {
            if (expiresInSeconds < 1) throw new IllegalArgumentException("expiresInSeconds must be positive");
        }
    }

    record AdmissionResult(boolean allowed, long retryAfterSeconds) {
        public AdmissionResult {
            if (retryAfterSeconds < 0) {
                throw new IllegalArgumentException("retryAfterSeconds must not be negative");
            }
        }
    }

    enum Purpose {
        EMAIL_VERIFICATION,
        PASSWORD_RESET
    }

    enum Status {
        VERIFIED,
        WRONG_CODE,
        EXPIRED,
        SUPERSEDED,
        TOO_MANY_ATTEMPTS,
        MISMATCH
    }

    private static void requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
    }
}
