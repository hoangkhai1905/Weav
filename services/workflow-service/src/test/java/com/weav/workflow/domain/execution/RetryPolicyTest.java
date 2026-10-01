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
    void retriesOnlyTransientCodes() {
        for (String code : new String[] {"NETWORK_ERROR", "TIMEOUT", "WORKER_INTERRUPTED", "AI_BUSY",
                "AI_PROVIDER_UNAVAILABLE", "AI_TIMEOUT", "HTTP_TIMEOUT", "HTTP_RATE_LIMITED",
                "HTTP_DEPENDENCY_UNAVAILABLE", "CONNECTION_UNAVAILABLE", "OCR_UNAVAILABLE"}) {
            assertTrue(policy.retryable(code), code);
        }
        assertFalse(policy.retryable(null));
        assertFalse(policy.retryable("HTTP_BUSINESS_REJECTED"));
        assertFalse(policy.retryable("UNKNOWN_ERROR"));
        assertFalse(policy.retryable("AI_OUTPUT_INVALID"));
        assertFalse(policy.retryable("OUTCOME_UNKNOWN"));
    }

    @Test
    void doesNotRetryPermanentDomainFailuresOrConfirmedAuthenticationRejections() {
        assertFalse(policy.retryable("MAPPING_ERROR"));
        assertFalse(policy.retryable("CONFIGURATION_ERROR"));
        assertFalse(policy.retryable("INVALID_CONFIGURATION"));
        assertFalse(policy.retryable("DEPENDENCY_NOT_CONFIGURED"));
        assertFalse(policy.retryable("AUTHENTICATION_REJECTED"));
    }

    @Test
    void jitterKeepsDelaysWithinHalfToOneAndAHalfOfTheBase() {
        assertEquals(Duration.ofMillis(500), new RetryPolicy(() -> 0.0).delayAfter(1));
        assertEquals(Duration.ofMillis(1500), new RetryPolicy(() -> 0.999999).delayAfter(1));
        assertEquals(Duration.ofMillis(1000), new RetryPolicy(() -> 0.5).delayAfter(2).dividedBy(2));
        assertEquals(Duration.ZERO, new RetryPolicy(() -> 0.9).delayAfter(3));
        for (int i = 0; i < 200; i++) {
            Duration delay = policy.delayAfter(2);
            assertTrue(delay.toMillis() >= 1000 && delay.toMillis() <= 3000, delay.toString());
        }
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

        assertEquals(Duration.ofSeconds(1), policy.baseDelayAfter(1));
        assertEquals(Duration.ofSeconds(2), policy.baseDelayAfter(2));
        assertEquals(Duration.ZERO, policy.baseDelayAfter(3));
        assertThrows(IllegalArgumentException.class, () -> policy.delayAfter(0));
        assertThrows(IllegalArgumentException.class, () -> policy.canRetry(-1, true));
    }
}
