package com.weav.workspace.application.dto;

import java.util.Objects;
import java.util.UUID;

/** Safe callback result carrying only an identifier recovered from consumed server-side state. */
public record GoogleOAuthCallbackResult(UUID connectionId, FailureReason failureReason, String completionId) {

    public GoogleOAuthCallbackResult {
        if (failureReason == null && connectionId == null) {
            throw new IllegalArgumentException("A pending OAuth callback requires a connection");
        }
        if ((failureReason == null) != (completionId != null)) {
            throw new IllegalArgumentException("A completion id exists only for a pending callback");
        }
        if (failureReason == FailureReason.STATE_INVALID && connectionId != null) {
            throw new IllegalArgumentException("Invalid OAuth state cannot identify a connection");
        }
        if (failureReason != null && failureReason != FailureReason.STATE_INVALID && connectionId == null) {
            throw new IllegalArgumentException("A trusted connection is required for this callback failure");
        }
    }

    /** The code was received; an authenticated user must still complete the connection. */
    public static GoogleOAuthCallbackResult pending(UUID connectionId, String completionId) {
        return new GoogleOAuthCallbackResult(
                Objects.requireNonNull(connectionId), null, Objects.requireNonNull(completionId));
    }

    public static GoogleOAuthCallbackResult failure(UUID connectionId, FailureReason reason) {
        return new GoogleOAuthCallbackResult(connectionId, Objects.requireNonNull(reason), null);
    }

    public boolean isPending() {
        return failureReason == null;
    }

    @Override
    public String toString() {
        return "GoogleOAuthCallbackResult[connectionId=" + connectionId
                + ", outcome=" + (isPending() ? "PENDING" : "FAILED")
                + ", failureReason=" + (failureReason == null ? "<none>" : failureReason.code()) + "]";
    }

    public enum FailureReason {
        STATE_INVALID("state_invalid"),
        AUTHORIZATION_DENIED("authorization_denied"),
        AUTHORIZATION_CHANGED("authorization_changed"),
        TOKEN_EXCHANGE_FAILED("token_exchange_failed"),
        VERIFICATION_FAILED("verification_failed");

        private final String code;

        FailureReason(String code) {
            this.code = code;
        }

        public String code() {
            return code;
        }
    }
}
