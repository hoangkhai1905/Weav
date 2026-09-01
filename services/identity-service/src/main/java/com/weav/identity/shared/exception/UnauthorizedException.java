package com.weav.identity.shared.exception;

public class UnauthorizedException extends DomainException {

    public UnauthorizedException() {
        this("Authentication is required");
    }

    public UnauthorizedException(String message) {
        super("UNAUTHORIZED", message);
    }
}
