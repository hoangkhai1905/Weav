package com.weav.identity.application.dto;

import com.weav.identity.application.validation.OAuthProtocolPolicy;

/**
 * One-use exchange contract. The browser submits the verifier here; it is not
 * retained in the backend transaction record.
 */
public record OAuthExchangeCommand(
        String clientId,
        String returnTargetId,
        String transactionId,
        OAuthSecret handoffCode,
        OAuthSecret codeVerifier
) {
    public OAuthExchangeCommand {
        OAuthProtocolPolicy.requireLogicalId(clientId, "clientId");
        OAuthProtocolPolicy.requireLogicalId(returnTargetId, "returnTargetId");
        OAuthProtocolPolicy.requireOpaqueToken(transactionId, "transactionId");
        java.util.Objects.requireNonNull(handoffCode, "handoffCode must not be null");
        java.util.Objects.requireNonNull(codeVerifier, "codeVerifier must not be null");
        OAuthProtocolPolicy.requireOpaqueToken(handoffCode.value(), "handoffCode");
        OAuthProtocolPolicy.requireVerifier(codeVerifier.value());
    }

    @Override
    public String toString() {
        return "OAuthExchangeCommand[clientId=" + clientId
                + ", returnTargetId=" + returnTargetId
                + ", transactionId=<redacted>, handoffCode=<redacted>, codeVerifier=<redacted>]";
    }
}
