package com.weav.workflow.application.trigger;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WebhookIngressRateLimiterTest {
    @Test
    void limitsTheProcessWideFixedWindowAndResetsAfterItExpires() {
        AtomicLong now = new AtomicLong(10);
        WebhookIngressRateLimiter limiter = new WebhookIngressRateLimiter(2, Duration.ofSeconds(1), now::get);

        assertTrue(limiter.tryAcquire());
        assertTrue(limiter.tryAcquire());
        assertFalse(limiter.tryAcquire());

        now.addAndGet(Duration.ofSeconds(1).toNanos());
        assertTrue(limiter.tryAcquire());
    }
}
