package com.weav.workflow.domain.exception;

public class BadRequestException extends DomainException {

    public BadRequestException(String message) {
        super("BAD_REQUEST", message);
    }

    /** A bad request with its own machine-readable code, for example {@code TEMPLATE_NODE_NOT_SHAREABLE}. */
    public BadRequestException(String code, String message) {
        super(code, message);
    }
}
