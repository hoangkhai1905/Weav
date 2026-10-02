package com.weav.workspace.domain.exception;

/** A provider explicitly confirmed that the stored Google authorization is no longer valid. */
public final class AuthenticationRejectedException extends DomainException {

    public AuthenticationRejectedException() {
        super("AUTHENTICATION_REJECTED", "Connection authentication was rejected");
    }
}
