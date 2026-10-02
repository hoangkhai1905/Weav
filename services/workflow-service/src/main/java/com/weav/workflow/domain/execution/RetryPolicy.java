package com.weav.workflow.domain.execution;

import java.time.Duration;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.DoubleSupplier;

/** V1 retry limits for transient node execution failures. */
public final class RetryPolicy {
    public static final int MAX_ATTEMPTS = 3;

    private static final Set<String> TRANSIENT_CODES = Set.of(
            "NETWORK_ERROR",
            "TIMEOUT",
            "WORKER_INTERRUPTED",
            "AI_BUSY",
            "AI_PROVIDER_UNAVAILABLE",
            "AI_TIMEOUT",
            "HTTP_TIMEOUT",
            "HTTP_RATE_LIMITED",
            "HTTP_DEPENDENCY_UNAVAILABLE",
            "CONNECTION_UNAVAILABLE",
            "OCR_UNAVAILABLE");
    private static final Set<String> PERMANENT_CODES = Set.of(
            "MAPPING_ERROR",
            "CONFIGURATION_ERROR",
            "INVALID_CONFIGURATION",
            "DEPENDENCY_NOT_CONFIGURED",
            "AI_QUOTA_EXCEEDED",
            "AUTHENTICATION_REJECTED");

    private final DoubleSupplier random;

    public RetryPolicy() {
        this(() -> ThreadLocalRandom.current().nextDouble());
    }

    /** @param random supplies values in [0, 1); injected so tests stay deterministic. */
    public RetryPolicy(DoubleSupplier random) {
        this.random = random;
    }

    public boolean retryable(String code) {
        if (code == null || PERMANENT_CODES.contains(code)) {
            return false;
        }
        return TRANSIENT_CODES.contains(code);
    }

    /** Nominal delay after the consumed attempt, before jitter. */
    public Duration baseDelayAfter(int attemptNumber) {
        if (attemptNumber < 1 || attemptNumber > MAX_ATTEMPTS) {
            throw new IllegalArgumentException("Attempt number must be between one and the maximum attempts.");
        }
        return switch (attemptNumber) {
            case 1 -> Duration.ofSeconds(1);
            case 2 -> Duration.ofSeconds(2);
            default -> Duration.ZERO;
        };
    }

    /** Delay after the consumed attempt with +/-50% jitter; there is no delay after the final attempt. */
    public Duration delayAfter(int attemptNumber) {
        long millis = baseDelayAfter(attemptNumber).toMillis();
        return Duration.ofMillis(Math.round(millis * (0.5 + random.getAsDouble())));
    }

    public boolean canRetry(int attemptsConsumed, boolean retryable) {
        if (attemptsConsumed < 0) {
            throw new IllegalArgumentException("Consumed attempt count cannot be negative.");
        }
        return retryable && attemptsConsumed > 0 && attemptsConsumed < MAX_ATTEMPTS;
    }
}
