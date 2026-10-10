package com.weav.workspace.domain.exception;

/** Maps to HTTP 410: the resource existed but can no longer be used. */
public class GoneException extends DomainException {

    protected GoneException(String code, String message) {
        super(code, message);
    }
}
