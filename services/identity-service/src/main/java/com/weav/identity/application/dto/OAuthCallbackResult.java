package com.weav.identity.application.dto;

import com.weav.identity.application.validation.OAuthProtocolPolicy;

import java.net.URI;
import java.util.Objects;

/**
 * Safe callback outcome. Only a valid consumed transaction may carry a
 * registered return target; the raw handoff code is never represented in a
 * string form.
 */
public record OAuthCallbackResult(
        Status status,
        String transactionId,
        URI returnTargetUri,
        OAuthSecret handoffCode
) {

    public enum Status {
        COMPLETED,
        CANCELLED,
        PROVIDER_UNAVAILABLE,
        INVALID
    }

    public OAuthCallbackResult {
        Objects.requireNonNull(status, "status must not be null");
        if (status == Status.INVALID) {
            if (transactionId != null || returnTargetUri != null || handoffCode != null) {
                throw new IllegalArgumentException("invalid callback must not expose redirect data");
            }
        } else {
            OAuthProtocolPolicy.requireOpaqueToken(transactionId, "transactionId");
            Objects.requireNonNull(returnTargetUri, "returnTargetUri must not be null");
            if ((status == Status.COMPLETED) != (handoffCode != null)) {
                throw new IllegalArgumentException("only a completed callback may expose a handoff code");
            }
        }
    }

    public static OAuthCallbackResult completed(String transactionId, URI returnTargetUri, OAuthSecret handoffCode) {
        return new OAuthCallbackResult(Status.COMPLETED, transactionId, returnTargetUri, handoffCode);
    }

    public static OAuthCallbackResult cancelled(String transactionId, URI returnTargetUri) {
        return new OAuthCallbackResult(Status.CANCELLED, transactionId, returnTargetUri, null);
    }

    public static OAuthCallbackResult providerUnavailable(String transactionId, URI returnTargetUri) {
        return new OAuthCallbackResult(Status.PROVIDER_UNAVAILABLE, transactionId, returnTargetUri, null);
    }

    public static OAuthCallbackResult invalid() {
        return new OAuthCallbackResult(Status.INVALID, null, null, null);
    }

    @Override
    public String toString() {
        return "OAuthCallbackResult[status=" + status
                + ", transactionId=<redacted>, returnTargetUri=<redacted>, handoffCode=<redacted>]";
    }
}
