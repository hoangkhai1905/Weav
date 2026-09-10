package com.weav.identity.presentation.http.request;

/** Deliberately has no Bean Validation annotation: last-login-method protection runs first. */
public record OAuthUnlinkRequest(String currentPassword) {

    @Override
    public String toString() {
        return "OAuthUnlinkRequest[currentPassword=<redacted>]";
    }
}
