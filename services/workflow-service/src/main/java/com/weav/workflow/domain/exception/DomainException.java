package com.weav.workflow.domain.exception;

public abstract class DomainException extends WeavException {

    protected DomainException(String code, String message) {
        super(code, message);
    }
}
