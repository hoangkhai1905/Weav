package com.weav.workflow.domain.exception;

public class BadRequestException extends DomainException {

    public BadRequestException(String message) {
        super("BAD_REQUEST", message);
    }
}
