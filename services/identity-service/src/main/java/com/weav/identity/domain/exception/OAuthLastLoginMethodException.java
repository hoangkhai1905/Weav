package com.weav.identity.domain.exception;

/** The requested unlink would remove the user's final usable login method. */
public final class OAuthLastLoginMethodException extends DomainException {

    public OAuthLastLoginMethodException() {
        super("OAUTH_LAST_LOGIN_METHOD", "The last usable login method cannot be removed");
    }
}
