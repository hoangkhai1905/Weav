package com.weav.workspace.domain.exception;

public class ConflictException extends DomainException {

    public ConflictException(String message) {
        this("CONFLICT", message);
    }

    protected ConflictException(String code, String message) {
        super(code, message);
    }
}
