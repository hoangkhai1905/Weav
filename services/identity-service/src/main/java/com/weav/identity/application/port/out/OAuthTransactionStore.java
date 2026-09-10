package com.weav.identity.application.port.out;

import com.weav.identity.application.dto.OAuthSecret;
import com.weav.identity.application.validation.OAuthProtocolPolicy;

import java.time.Duration;
import java.util.Objects;
import java.util.UUID;

/**
 * Atomic short-lived OAuth state boundary. Implementations must compare all
 * supplied bindings and consume only the matching record in one operation;
 * mismatches must not delete or mutate another valid handoff.
 * Implementations that physically delete consumed or expired records may
 * report {@code NOT_FOUND} for replay and expiry; the explicit
 * {@code EXPIRED}/{@code ALREADY_CONSUMED} statuses are reserved for an
 * implementation that retains bounded tombstones.
 */
public interface OAuthTransactionStore {

    TransactionReceipt start(Transaction transaction);

    CallbackConsumeResult consumeCallback(CallbackBinding binding);

    HandoffReceipt issueHandoff(Handoff handoff);

    HandoffConsumeResult consumeHandoff(HandoffBinding binding);

    enum Intent {
        LOGIN,
        LINK
    }

    enum CallbackStatus {
        CONSUMED,
        NOT_FOUND,
        MISMATCH,
        EXPIRED,
        ALREADY_CONSUMED
    }

    enum HandoffStatus {
        CONSUMED,
        NOT_FOUND,
        MISMATCH,
        EXPIRED,
        ALREADY_CONSUMED,
        TOO_MANY_PROOF_FAILURES
    }

    record Transaction(
            String transactionId,
            Intent intent,
            String clientId,
            String returnTargetId,
            String providerStateFingerprint,
            String nonceFingerprint,
            OAuthSecret providerCodeVerifier,
            String handoffCodeChallenge,
            UUID userId,
            UUID sessionId,
            OAuthSecret credentialFingerprint,
            Duration ttl
    ) {
        public Transaction {
            OAuthProtocolPolicy.requireOpaqueToken(transactionId, "transactionId");
            Objects.requireNonNull(intent, "intent must not be null");
            requireLogicalId(clientId, "clientId");
            requireLogicalId(returnTargetId, "returnTargetId");
            OAuthProtocolPolicy.requireOpaqueToken(providerStateFingerprint, "providerStateFingerprint");
            OAuthProtocolPolicy.requireOpaqueToken(nonceFingerprint, "nonceFingerprint");
            Objects.requireNonNull(providerCodeVerifier, "providerCodeVerifier must not be null");
            OAuthProtocolPolicy.requireS256Challenge(handoffCodeChallenge);
            requirePositive(ttl, "ttl");
            if (intent == Intent.LINK) {
                Objects.requireNonNull(userId, "userId must be supplied for LINK");
                Objects.requireNonNull(sessionId, "sessionId must be supplied for LINK");
                Objects.requireNonNull(credentialFingerprint, "credentialFingerprint must be supplied for LINK");
            } else if (userId != null || sessionId != null || credentialFingerprint != null) {
                throw new IllegalArgumentException("LOGIN transaction must not contain link bindings");
            }
        }

        @Override
        public String toString() {
            return "Transaction[transactionId=<redacted>, intent=" + intent
                    + ", clientId=" + clientId
                    + ", returnTargetId=" + returnTargetId
                    + ", providerStateFingerprint=<redacted>, nonceFingerprint=<redacted>"
                    + ", providerCodeVerifier=<redacted>, handoffCodeChallenge=<redacted>"
                    + ", userId=<redacted>, sessionId=<redacted>, credentialFingerprint=<redacted>, ttl=" + ttl + "]";
        }
    }

    record TransactionReceipt(boolean accepted, long expiresInSeconds) {
        public TransactionReceipt {
            if (expiresInSeconds < 1) {
                throw new IllegalArgumentException("expiresInSeconds must be positive");
            }
        }
    }

    record CallbackBinding(
            String transactionId,
            String correlationTransactionId,
            String providerStateFingerprint
    ) {
        public CallbackBinding {
            OAuthProtocolPolicy.requireOpaqueToken(transactionId, "transactionId");
            OAuthProtocolPolicy.requireOpaqueToken(correlationTransactionId, "correlationTransactionId");
            OAuthProtocolPolicy.requireOpaqueToken(providerStateFingerprint, "providerStateFingerprint");
        }

        @Override
        public String toString() {
            return "CallbackBinding[transactionId=<redacted>, correlationTransactionId=<redacted>, providerStateFingerprint=<redacted>]";
        }
    }

    record CallbackConsumeResult(CallbackStatus status, Transaction transaction) {
        public CallbackConsumeResult {
            Objects.requireNonNull(status, "status must not be null");
            if ((status == CallbackStatus.CONSUMED) != (transaction != null)) {
                throw new IllegalArgumentException("only a consumed callback may expose transaction state");
            }
        }
    }

    record Handoff(
            String handoffCodeFingerprint,
            String transactionId,
            Intent intent,
            String clientId,
            String returnTargetId,
            String codeChallenge,
            OAuthProviderClient.ProviderIdentity providerIdentity,
            UUID userId,
            UUID sessionId,
            OAuthSecret credentialFingerprint,
            Duration ttl,
            int maxProofFailures
    ) {
        public Handoff {
            OAuthProtocolPolicy.requireOpaqueToken(handoffCodeFingerprint, "handoffCodeFingerprint");
            OAuthProtocolPolicy.requireOpaqueToken(transactionId, "transactionId");
            Objects.requireNonNull(intent, "intent must not be null");
            requireLogicalId(clientId, "clientId");
            requireLogicalId(returnTargetId, "returnTargetId");
            OAuthProtocolPolicy.requireS256Challenge(codeChallenge);
            Objects.requireNonNull(providerIdentity, "providerIdentity must not be null");
            requirePositive(ttl, "ttl");
            if (maxProofFailures < 1) {
                throw new IllegalArgumentException("maxProofFailures must be positive");
            }
            if (intent == Intent.LINK) {
                Objects.requireNonNull(userId, "userId must be supplied for LINK");
                Objects.requireNonNull(sessionId, "sessionId must be supplied for LINK");
                Objects.requireNonNull(credentialFingerprint, "credentialFingerprint must be supplied for LINK");
            } else if (userId != null || sessionId != null || credentialFingerprint != null) {
                throw new IllegalArgumentException("LOGIN handoff must not contain link bindings");
            }
        }

        @Override
        public String toString() {
            return "Handoff[handoffCodeFingerprint=<redacted>, transactionId=<redacted>, intent=" + intent
                    + ", clientId=" + clientId + ", returnTargetId=" + returnTargetId
                    + ", codeChallenge=<redacted>, providerIdentity=<redacted>, userId=<redacted>, sessionId=<redacted>"
                    + ", credentialFingerprint=<redacted>, ttl=" + ttl
                    + ", maxProofFailures=" + maxProofFailures + "]";
        }
    }

    record HandoffReceipt(boolean accepted, long expiresInSeconds) {
        public HandoffReceipt {
            if (expiresInSeconds < 1) {
                throw new IllegalArgumentException("expiresInSeconds must be positive");
            }
        }
    }

    record HandoffBinding(
            String handoffCodeFingerprint,
            String transactionId,
            Intent intent,
            String clientId,
            String returnTargetId,
            String codeChallenge
    ) {
        public HandoffBinding {
            OAuthProtocolPolicy.requireOpaqueToken(handoffCodeFingerprint, "handoffCodeFingerprint");
            OAuthProtocolPolicy.requireOpaqueToken(transactionId, "transactionId");
            Objects.requireNonNull(intent, "intent must not be null");
            requireLogicalId(clientId, "clientId");
            requireLogicalId(returnTargetId, "returnTargetId");
            OAuthProtocolPolicy.requireS256Challenge(codeChallenge);
        }

        @Override
        public String toString() {
            return "HandoffBinding[handoffCodeFingerprint=<redacted>, transactionId=<redacted>, intent=" + intent
                    + ", clientId=" + clientId + ", returnTargetId=" + returnTargetId
                    + ", codeChallenge=<redacted>]";
        }
    }

    record HandoffConsumeResult(HandoffStatus status, Handoff handoff) {
        public HandoffConsumeResult {
            Objects.requireNonNull(status, "status must not be null");
            if ((status == HandoffStatus.CONSUMED) != (handoff != null)) {
                throw new IllegalArgumentException("only a consumed handoff may expose handoff state");
            }
        }
    }

    private static void requireLogicalId(String value, String name) {
        if (value == null || value.isBlank() || value.length() > 32
                || value.chars().anyMatch(character -> character < 0x20 || character > 0x7e
                || Character.isWhitespace(character))) {
            throw new IllegalArgumentException(name + " must be printable non-whitespace ASCII of length 1..32");
        }
    }

    private static void requirePositive(Duration value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        if (value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(name + " must be positive");
        }
    }
}
