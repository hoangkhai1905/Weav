package com.weav.identity.application.dto;

import com.weav.identity.application.validation.OAuthProtocolPolicy;

import java.net.URI;
import java.util.Objects;

/** Safe result of an application OAuth start operation. */
public record OAuthStartResult(
        String transactionId,
        URI authorizationUrl,
        URI returnTargetUri
) {

    public OAuthStartResult {
        OAuthProtocolPolicy.requireOpaqueToken(transactionId, "transactionId");
        Objects.requireNonNull(authorizationUrl, "authorizationUrl must not be null");
        Objects.requireNonNull(returnTargetUri, "returnTargetUri must not be null");
    }

    @Override
    public String toString() {
        return "OAuthStartResult[transactionId=<redacted>, authorizationUrl=<redacted>, returnTargetUri=<redacted>]";
    }
}
