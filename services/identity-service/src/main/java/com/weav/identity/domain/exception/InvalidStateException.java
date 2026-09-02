package com.weav.identity.domain.exception;

public class InvalidStateException extends DomainException {

    public InvalidStateException(String message) {
        super("INVALID_STATE", message);
    }
}
