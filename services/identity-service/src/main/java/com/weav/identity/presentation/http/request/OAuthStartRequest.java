package com.weav.identity.presentation.http.request;

import com.weav.identity.application.dto.OAuthStartCommand;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Browser-owned PKCE challenge plus server-selected logical registration IDs. */
public record OAuthStartRequest(
        @NotBlank
        @Size(max = 32)
        @Pattern(regexp = "^[\\x21-\\x7E]{1,32}$")
        String clientId,

        @NotBlank
        @Size(max = 32)
        @Pattern(regexp = "^[\\x21-\\x7E]{1,32}$")
        String returnTargetId,

        @NotBlank
        @Size(min = 43, max = 43)
        @Pattern(regexp = "^[A-Za-z0-9_-]{43}$")
        String codeChallenge,

        @NotBlank
        @Pattern(regexp = "^S256$")
        String codeChallengeMethod
) {

    public OAuthStartCommand toCommand() {
        return new OAuthStartCommand(clientId, returnTargetId, codeChallenge, codeChallengeMethod);
    }

    @Override
    public String toString() {
        return "OAuthStartRequest[clientId=" + clientId
                + ", returnTargetId=" + returnTargetId
                + ", codeChallenge=<redacted>, codeChallengeMethod=" + codeChallengeMethod + "]";
    }
}
