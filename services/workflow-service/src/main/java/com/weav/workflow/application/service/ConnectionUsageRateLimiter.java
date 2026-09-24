package com.weav.workflow.application.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Objects;
import java.util.function.LongSupplier;

/** A process-wide fixed window with constant memory use. */
@Component
public final class ConnectionUsageRateLimiter {

    private final int requestsPerWindow;
    private final long windowNanos;
    private final LongSupplier monotonicNanos;
    private long windowStartedAt;
    private int acceptedRequests;

    @Autowired
    public ConnectionUsageRateLimiter(
            @Value("${workflow.connection-usage.requests-per-window:600}") int requestsPerWindow,
            @Value("${workflow.connection-usage.window:1m}") Duration window) {
        this(requestsPerWindow, window, System::nanoTime);
    }

    public ConnectionUsageRateLimiter(int requestsPerWindow, Duration window, LongSupplier monotonicNanos) {
        if (requestsPerWindow < 1) {
            throw new IllegalArgumentException("requestsPerWindow must be positive");
        }
        Objects.requireNonNull(window, "window must not be null");
        if (window.isZero() || window.isNegative()) {
            throw new IllegalArgumentException("window must be positive");
        }
        Objects.requireNonNull(monotonicNanos, "monotonicNanos must not be null");
        long configuredWindowNanos;
        try {
            configuredWindowNanos = window.toNanos();
        } catch (ArithmeticException exception) {
            throw new IllegalArgumentException("window is too large", exception);
        }
        if (configuredWindowNanos < 1) {
            throw new IllegalArgumentException("window must be at least one nanosecond");
        }

        this.requestsPerWindow = requestsPerWindow;
        this.windowNanos = configuredWindowNanos;
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
