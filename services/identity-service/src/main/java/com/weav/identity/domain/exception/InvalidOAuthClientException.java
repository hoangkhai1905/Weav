package com.weav.identity.domain.exception;

/** The request did not select an exact server-registered OAuth client. */
public final class InvalidOAuthClientException extends DomainException {

    public InvalidOAuthClientException() {
        super("INVALID_OAUTH_CLIENT", "The OAuth client selection is invalid");
    }
}
