package com.weav.workflow.domain.exception;

public final class GenerationRateLimitedException extends DomainException {
    public GenerationRateLimitedException() {
        super("GENERATION_RATE_LIMITED", "Too many generation requests. Try again in a minute.");
    }
}
