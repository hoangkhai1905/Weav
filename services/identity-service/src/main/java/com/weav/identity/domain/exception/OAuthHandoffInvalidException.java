package com.weav.identity.domain.exception;

/** Generic one-use handoff failure that does not disclose provider details. */
public final class OAuthHandoffInvalidException extends DomainException {

    public OAuthHandoffInvalidException() {
        super("OAUTH_HANDOFF_INVALID", "The OAuth handoff is invalid");
    }
}
