package com.weav.identity.presentation.http.request;

import com.weav.identity.application.dto.OAuthStartCommand;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Authenticated LINK start request; account identity comes only from JWT claims. */
public record OAuthLinkStartRequest(
        @NotBlank(message = "Current password is required")
        @Size(min = 8, max = 72, message = "Password must be between 8 and 72 characters")
        String currentPassword,

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
        return "OAuthLinkStartRequest[currentPassword=<redacted>, clientId=" + clientId
                + ", returnTargetId=" + returnTargetId
                + ", codeChallenge=<redacted>, codeChallengeMethod=" + codeChallengeMethod + "]";
    }
}
