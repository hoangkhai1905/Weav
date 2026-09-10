package com.weav.identity.domain.exception;

/**
 * The provider subject is valid, but its canonical email already belongs to
 * a local account. The caller must authenticate locally and explicitly link
 * the provider; login never auto-links or merges accounts.
 */
public final class OAuthAccountLinkRequiredException extends DomainException {

    public OAuthAccountLinkRequiredException() {
        super("ACCOUNT_LINK_REQUIRED", "Account linking is required");
    }
}
