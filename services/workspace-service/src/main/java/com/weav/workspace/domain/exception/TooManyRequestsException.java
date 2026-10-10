package com.weav.workspace.domain.exception;

/** Maps to HTTP 429: a per-resource limit or cooldown was hit. */
public class TooManyRequestsException extends DomainException {

    protected TooManyRequestsException(String code, String message) {
        super(code, message);
    }
}
