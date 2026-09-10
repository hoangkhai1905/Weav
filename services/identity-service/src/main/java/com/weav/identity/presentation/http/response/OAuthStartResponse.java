package com.weav.identity.presentation.http.response;

import java.net.URI;

public record OAuthStartResponse(
        String transactionId,
        URI authorizationUrl,
        String csrfToken
) {

    @Override
    public String toString() {
        return "OAuthStartResponse[transactionId=<redacted>, authorizationUrl=<redacted>, csrfToken=<redacted>]";
    }
}
