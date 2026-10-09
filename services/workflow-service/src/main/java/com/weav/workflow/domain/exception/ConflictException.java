package com.weav.workflow.domain.exception;

public class ConflictException extends DomainException {

    public ConflictException(String message) {
        super("CONFLICT", message);
    }

    protected ConflictException(String code, String message) {
        super(code, message);
    }
}
