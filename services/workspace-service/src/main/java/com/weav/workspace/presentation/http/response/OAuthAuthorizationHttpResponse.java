package com.weav.workspace.presentation.http.response;

import com.weav.workspace.application.dto.OAuthAuthorizationResponse;

import java.util.Objects;

/** HTTP representation of an authorization URL; its query contains one-time state. */
public record OAuthAuthorizationHttpResponse(String authorizationUrl) {

    public OAuthAuthorizationHttpResponse {
        Objects.requireNonNull(authorizationUrl, "authorizationUrl must not be null");
    }

    public static OAuthAuthorizationHttpResponse from(OAuthAuthorizationResponse response) {
        return new OAuthAuthorizationHttpResponse(response.authorizationUrl());
    }

    @Override
    public String toString() {
        return "OAuthAuthorizationHttpResponse[authorizationUrl=<redacted>]";
    }
}
