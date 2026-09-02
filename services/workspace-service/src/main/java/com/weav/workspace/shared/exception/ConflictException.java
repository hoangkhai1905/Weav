package com.weav.workspace.shared.exception;

public class ConflictException extends DomainException {

    public ConflictException(String message) {
        super("CONFLICT", message);
    }
}
