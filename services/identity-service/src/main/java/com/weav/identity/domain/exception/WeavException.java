package com.weav.identity.domain.exception;

public abstract class WeavException extends RuntimeException {

    private final String code;

    protected WeavException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
