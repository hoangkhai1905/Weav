package com.weav.identity.infrastructure.security;

public final class AuthRateLimitExceededException extends RuntimeException {

    private final long retryAfterSeconds;

    public AuthRateLimitExceededException(long retryAfterSeconds) {
        super("Too many authentication attempts");
        this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
    }

    public long retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
