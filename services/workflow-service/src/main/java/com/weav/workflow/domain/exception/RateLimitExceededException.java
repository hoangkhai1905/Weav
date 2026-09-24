package com.weav.workflow.domain.exception;

public final class RateLimitExceededException extends DomainException {

    public RateLimitExceededException() {
        super("RATE_LIMIT_EXCEEDED", "Workflow connection usage lookup rate limit exceeded");
    }
}
