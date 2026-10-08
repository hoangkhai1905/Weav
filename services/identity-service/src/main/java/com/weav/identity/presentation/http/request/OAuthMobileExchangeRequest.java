package com.weav.identity.presentation.http.request;

import com.weav.identity.application.dto.OAuthClientRegistration;
import com.weav.identity.application.dto.OAuthExchangeCommand;
import com.weav.identity.application.dto.OAuthSecret;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Mobile LOGIN exchange. The client is fixed to {@code mobile} by the route, so the caller cannot pick another
 * registration; the app sends only what it received on the deep link plus its own PKCE verifier.
 */
public record OAuthMobileExchangeRequest(
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
                OAuthClientRegistration.MOBILE,
                OAuthClientRegistration.MOBILE,
                transactionId,
                new OAuthSecret(handoffCode),
                new OAuthSecret(codeVerifier));
    }

    @Override
    public String toString() {
        return "OAuthMobileExchangeRequest[transactionId=<redacted>, handoffCode=<redacted>, codeVerifier=<redacted>]";
    }
}
