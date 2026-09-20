package com.weav.workspace.application.dto;

import java.util.Objects;
import java.util.UUID;

/** Safe callback result carrying only an identifier recovered from consumed server-side state. */
public record GoogleOAuthCallbackResult(UUID connectionId, FailureReason failureReason) {

    public GoogleOAuthCallbackResult {
        if (failureReason == null && connectionId == null) {
            throw new IllegalArgumentException("A successful OAuth callback requires a connection");
        }
        if (failureReason == FailureReason.STATE_INVALID && connectionId != null) {
            throw new IllegalArgumentException("Invalid OAuth state cannot identify a connection");
        }
        if (failureReason != null && failureReason != FailureReason.STATE_INVALID && connectionId == null) {
            throw new IllegalArgumentException("A trusted connection is required for this callback failure");
        }
    }

    public static GoogleOAuthCallbackResult success(UUID connectionId) {
        return new GoogleOAuthCallbackResult(Objects.requireNonNull(connectionId), null);
    }

    public static GoogleOAuthCallbackResult failure(UUID connectionId, FailureReason reason) {
        return new GoogleOAuthCallbackResult(connectionId, Objects.requireNonNull(reason));
    }

    public boolean succeeded() {
        return failureReason == null;
    }

    @Override
    public String toString() {
        return "GoogleOAuthCallbackResult[connectionId=" + connectionId
                + ", outcome=" + (succeeded() ? "SUCCESS" : "FAILED")
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
