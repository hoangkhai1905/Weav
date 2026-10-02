package com.weav.workspace.domain.exception;

public final class IdempotencyKeyReusedException extends DomainException {

    public IdempotencyKeyReusedException() {
        super("IDEMPOTENCY_KEY_REUSED", "The Idempotency-Key was already used with a different request");
    }
}
