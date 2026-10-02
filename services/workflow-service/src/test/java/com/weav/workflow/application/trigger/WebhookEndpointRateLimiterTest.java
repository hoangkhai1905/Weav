package com.weav.workflow.application.trigger;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WebhookEndpointRateLimiterTest {
    @Test
    void limitsEachEndpointIndependentlyAndResetsAfterTheWindow() {
        AtomicLong now = new AtomicLong(10);
        WebhookEndpointRateLimiter limiter = new WebhookEndpointRateLimiter(2, Duration.ofSeconds(1), now::get);
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();

        assertTrue(limiter.tryAcquire(a));
        assertTrue(limiter.tryAcquire(a));
        assertFalse(limiter.tryAcquire(a));
        assertTrue(limiter.tryAcquire(b));

        now.addAndGet(Duration.ofSeconds(1).toNanos());
        assertTrue(limiter.tryAcquire(a));
    }
}
