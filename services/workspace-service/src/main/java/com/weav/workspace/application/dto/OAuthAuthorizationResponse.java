package com.weav.workspace.application.dto;

/** Safe start response. The URL contains the one-time state and is redacted from diagnostics. */
public record OAuthAuthorizationResponse(String authorizationUrl) {

    public OAuthAuthorizationResponse {
        if (authorizationUrl == null || authorizationUrl.isBlank() || authorizationUrl.length() > 8192) {
            throw new IllegalArgumentException("authorizationUrl is invalid");
        }
    }

    @Override
    public String toString() {
        return "OAuthAuthorizationResponse[authorizationUrl=<redacted>]";
    }
}
