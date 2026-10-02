package com.weav.identity.application.validation;

/** Framework-free signal for an OTP admission limit rejection. */
public final class OtpRateLimitException extends RuntimeException {

    private final long retryAfterSeconds;

    public OtpRateLimitException(long retryAfterSeconds) {
        super("Too many requests");
        if (retryAfterSeconds < 0) {
            throw new IllegalArgumentException("retryAfterSeconds must not be negative");
        }
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public long getRetryAfterSeconds() {
        return retryAfterSeconds;
    }
}
