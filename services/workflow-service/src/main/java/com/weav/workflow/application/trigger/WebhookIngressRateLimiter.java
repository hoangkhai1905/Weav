package com.weav.workflow.application.trigger;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Objects;
import java.util.function.LongSupplier;

/** Process-wide fixed-window limiter with constant memory use. */
@Component
public final class WebhookIngressRateLimiter {
    private final int requestsPerWindow;
    private final long windowNanos;
    private final LongSupplier monotonicNanos;
    private long windowStartedAt;
    private int acceptedRequests;

    @Autowired
    public WebhookIngressRateLimiter(
            @Value("${weav.workflow.webhook.rate-limit.requests-per-window:6000}") int requestsPerWindow,
            @Value("${weav.workflow.webhook.rate-limit.window:1m}") Duration window) {
        this(requestsPerWindow, window, System::nanoTime);
    }

    WebhookIngressRateLimiter(int requestsPerWindow, Duration window, LongSupplier monotonicNanos) {
        if (requestsPerWindow < 1) {
            throw new IllegalArgumentException("requestsPerWindow must be positive");
        }
        Objects.requireNonNull(window, "window must not be null");
        if (window.isZero() || window.isNegative()) {
            throw new IllegalArgumentException("window must be positive");
        }
        Objects.requireNonNull(monotonicNanos, "monotonicNanos must not be null");
        long nanos;
        try {
            nanos = window.toNanos();
        } catch (ArithmeticException exception) {
            throw new IllegalArgumentException("window is too large", exception);
        }
        if (nanos < 1) {
            throw new IllegalArgumentException("window must be at least one nanosecond");
        }
        this.requestsPerWindow = requestsPerWindow;
        this.windowNanos = nanos;
        this.monotonicNanos = monotonicNanos;
        this.windowStartedAt = monotonicNanos.getAsLong();
    }

    public synchronized boolean tryAcquire() {
        long now = monotonicNanos.getAsLong();
        long elapsed = now - windowStartedAt;
        if (elapsed < 0 || elapsed >= windowNanos) {
            windowStartedAt = now;
            acceptedRequests = 0;
        }
        if (acceptedRequests >= requestsPerWindow) {
            return false;
        }
        acceptedRequests++;
        return true;
    }
}
