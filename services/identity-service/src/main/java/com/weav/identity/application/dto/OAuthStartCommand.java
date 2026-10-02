package com.weav.identity.application.dto;

import com.weav.identity.application.validation.OAuthProtocolPolicy;

import java.util.Objects;

/** Framework-free start contract; the server accepts only logical IDs. */
public record OAuthStartCommand(
        String clientId,
        String returnTargetId,
        String codeChallenge,
        String codeChallengeMethod
) {
    public OAuthStartCommand {
        OAuthProtocolPolicy.requireLogicalId(clientId, "clientId");
        OAuthProtocolPolicy.requireLogicalId(returnTargetId, "returnTargetId");
        OAuthProtocolPolicy.requireS256Challenge(codeChallenge);
        OAuthProtocolPolicy.requireS256Method(codeChallengeMethod);
    }

    @Override
    public String toString() {
        return "OAuthStartCommand[clientId=" + clientId
                + ", returnTargetId=" + returnTargetId
                + ", codeChallenge=<redacted>, codeChallengeMethod=" + codeChallengeMethod + "]";
    }
}
