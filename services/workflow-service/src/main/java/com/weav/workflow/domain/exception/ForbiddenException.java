package com.weav.workflow.domain.exception;

public class ForbiddenException extends DomainException {

    public ForbiddenException() {
        this("You do not have permission to perform this action");
    }

    public ForbiddenException(String message) {
        super("FORBIDDEN", message);
    }

    protected ForbiddenException(String code, String message) {
        super(code, message);
    }
}
