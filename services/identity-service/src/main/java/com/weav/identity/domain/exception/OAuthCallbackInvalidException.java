package com.weav.identity.domain.exception;

/** Generic callback failure that is safe to expose at the later HTTP boundary. */
public final class OAuthCallbackInvalidException extends DomainException {

    public OAuthCallbackInvalidException() {
        super("OAUTH_CALLBACK_INVALID", "The OAuth callback is invalid");
    }
}
