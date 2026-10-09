package com.weav.workflow.domain.exception;

public class ConflictException extends DomainException {

    public ConflictException(String message) {
        super("CONFLICT", message);
    }

    /** A conflict with its own machine-readable code, for example {@code TEMPLATE_LIMIT_REACHED}. */
    public ConflictException(String code, String message) {
        super(code, message);
    }
}
