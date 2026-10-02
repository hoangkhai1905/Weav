package com.weav.identity.presentation.http.response;

public record OAuthCsrfResponse(String csrfToken) {

    @Override
    public String toString() {
        return "OAuthCsrfResponse[csrfToken=<redacted>]";
    }
}
