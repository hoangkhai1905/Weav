package com.weav.workflow.domain.execution;

import java.time.Duration;
import java.util.Set;

/** V1 retry limits for transient node execution failures. */
public final class RetryPolicy {
    public static final int MAX_ATTEMPTS = 3;

    private static final Set<String> TRANSIENT_CODES = Set.of(
            "NETWORK_ERROR",
            "TIMEOUT",
            "WORKER_INTERRUPTED");
    private static final Set<String> PERMANENT_CODES = Set.of(
            "MAPPING_ERROR",
            "CONFIGURATION_ERROR",
            "INVALID_CONFIGURATION",
            "DEPENDENCY_NOT_CONFIGURED",
            "AUTHENTICATION_REJECTED");

    public boolean retryable(String code, Integer httpStatus) {
        if (code != null && PERMANENT_CODES.contains(code)) {
            return false;
        }
        if (httpStatus != null) {
            return httpStatus == 429 || httpStatus >= 500 && httpStatus <= 599;
        }
        return code != null && TRANSIENT_CODES.contains(code);
    }

    /** Returns the delay after the specified consumed attempt; there is no delay after the final attempt. */
    public Duration delayAfter(int attemptNumber) {
        if (attemptNumber < 1 || attemptNumber > MAX_ATTEMPTS) {
            throw new IllegalArgumentException("Attempt number must be between one and the maximum attempts.");
        }
        return switch (attemptNumber) {
            case 1 -> Duration.ofSeconds(1);
            case 2 -> Duration.ofSeconds(2);
            default -> Duration.ZERO;
        };
    }

    public boolean canRetry(int attemptsConsumed, boolean retryable) {
        if (attemptsConsumed < 0) {
            throw new IllegalArgumentException("Consumed attempt count cannot be negative.");
        }
        return retryable && attemptsConsumed > 0 && attemptsConsumed < MAX_ATTEMPTS;
    }
}
