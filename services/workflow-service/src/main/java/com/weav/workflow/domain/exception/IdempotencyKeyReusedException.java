package com.weav.workflow.domain.exception;

/** The same Idempotency-Key was replayed with a different request body. */
public final class IdempotencyKeyReusedException extends DomainException {
    public IdempotencyKeyReusedException() {
        super("IDEMPOTENCY_KEY_REUSED", "The Idempotency-Key was already used with a different request");
    }
}
