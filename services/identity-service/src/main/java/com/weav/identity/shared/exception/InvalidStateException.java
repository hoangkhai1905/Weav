package com.weav.identity.shared.exception;

public class InvalidStateException extends DomainException {

    public InvalidStateException(String message) {
        super("INVALID_STATE", message);
    }
}
