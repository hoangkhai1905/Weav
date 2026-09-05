package com.weav.workspace.domain.exception;

public class ConflictException extends DomainException {

    public ConflictException(String message) {
        super("CONFLICT", message);
    }
}
