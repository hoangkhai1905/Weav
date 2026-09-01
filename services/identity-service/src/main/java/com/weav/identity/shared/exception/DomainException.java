package com.weav.identity.shared.exception;

public abstract class DomainException extends WeavException {

    protected DomainException(String code, String message) {
        super(code, message);
    }
}
