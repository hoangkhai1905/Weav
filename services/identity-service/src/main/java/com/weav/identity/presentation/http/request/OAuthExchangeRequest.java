package com.weav.identity.presentation.http.request;

import com.weav.identity.application.dto.OAuthExchangeCommand;
import com.weav.identity.application.dto.OAuthSecret;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** The shared LOGIN/LINK exchange request; intent is selected by transport context. */
public record OAuthExchangeRequest(
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
        String transactionId,

        @NotBlank
        @Size(min = 43, max = 43)
        @Pattern(regexp = "^[A-Za-z0-9_-]{43}$")
        String handoffCode,

        @NotBlank
        @Size(min = 43, max = 128)
        @Pattern(regexp = "^[A-Za-z0-9._~-]{43,128}$")
        String codeVerifier
) {

    public OAuthExchangeCommand toCommand() {
        return new OAuthExchangeCommand(
                clientId,
                returnTargetId,
                transactionId,
                new OAuthSecret(handoffCode),
                new OAuthSecret(codeVerifier));
    }

    @Override
    public String toString() {
        return "OAuthExchangeRequest[clientId=" + clientId
                + ", returnTargetId=" + returnTargetId
                + ", transactionId=<redacted>, handoffCode=<redacted>, codeVerifier=<redacted>]";
    }
}
