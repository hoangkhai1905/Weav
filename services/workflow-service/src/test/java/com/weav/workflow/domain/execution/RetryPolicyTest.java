package com.weav.workflow.domain.execution;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RetryPolicyTest {
    private final RetryPolicy policy = new RetryPolicy();

    @Test
    void retriesOnlyTransientCodesAndTransientHttpStatuses() {
        assertTrue(policy.retryable("NETWORK_ERROR", null));
        assertTrue(policy.retryable("TIMEOUT", null));
        assertTrue(policy.retryable("WORKER_INTERRUPTED", null));
        assertTrue(policy.retryable("HTTP_ERROR", 429));
        assertTrue(policy.retryable(null, 500));
        assertTrue(policy.retryable("HTTP_ERROR", 599));

        assertFalse(policy.retryable("HTTP_ERROR", 400));
        assertFalse(policy.retryable("HTTP_ERROR", 401));
        assertFalse(policy.retryable("UNKNOWN_ERROR", null));
    }

    @Test
    void doesNotRetryPermanentDomainFailuresOrConfirmedAuthenticationRejections() {
        assertFalse(policy.retryable("MAPPING_ERROR", null));
        assertFalse(policy.retryable("CONFIGURATION_ERROR", null));
        assertFalse(policy.retryable("INVALID_CONFIGURATION", null));
        assertFalse(policy.retryable("DEPENDENCY_NOT_CONFIGURED", null));
        assertFalse(policy.retryable("AUTHENTICATION_REJECTED", 401));
        assertFalse(policy.retryable("MAPPING_ERROR", 503));
        assertFalse(policy.retryable("AUTHENTICATION_REJECTED", 503));
    }

    @Test
    void retryBudgetCountsTheInitialAttemptAndDelaysOnlyBetweenThreeAttempts() {
        assertEquals(3, RetryPolicy.MAX_ATTEMPTS);
        assertFalse(policy.canRetry(0, true));
        assertTrue(policy.canRetry(1, true));
        assertTrue(policy.canRetry(2, true));
        assertFalse(policy.canRetry(3, true));
        assertFalse(policy.canRetry(1, false));
        assertFalse(policy.canRetry(20, true));

        assertEquals(Duration.ofSeconds(1), policy.delayAfter(1));
        assertEquals(Duration.ofSeconds(2), policy.delayAfter(2));
        assertEquals(Duration.ZERO, policy.delayAfter(3));
        assertThrows(IllegalArgumentException.class, () -> policy.delayAfter(0));
        assertThrows(IllegalArgumentException.class, () -> policy.canRetry(-1, true));
    }
}
