package com.weav.workflow.application.trigger;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

/**
 * Per-endpoint fixed-window limiter, consulted only after the webhook secret verified, so unknown keys and bad
 * secrets never create or consume an entry. Memory is capped; expired windows are purged when the cap is hit.
 */
@Component
public final class WebhookEndpointRateLimiter {
    private static final int MAX_ENDPOINTS = 10_000;

    private final int requestsPerWindow;
    private final long windowNanos;
    private final LongSupplier monotonicNanos;
    private final ConcurrentHashMap<UUID, Window> windows = new ConcurrentHashMap<>();

    @Autowired
    public WebhookEndpointRateLimiter(
            @Value("${weav.workflow.webhook.rate-limit.endpoint-requests-per-window:120}") int requestsPerWindow,
            @Value("${weav.workflow.webhook.rate-limit.window:1m}") Duration window) {
        this(requestsPerWindow, window, System::nanoTime);
    }

    WebhookEndpointRateLimiter(int requestsPerWindow, Duration window, LongSupplier monotonicNanos) {
        if (requestsPerWindow < 1) {
            throw new IllegalArgumentException("requestsPerWindow must be positive");
        }
        Objects.requireNonNull(window, "window must not be null");
        if (window.isZero() || window.isNegative()) {
            throw new IllegalArgumentException("window must be positive");
        }
        this.requestsPerWindow = requestsPerWindow;
        this.windowNanos = window.toNanos();
        this.monotonicNanos = Objects.requireNonNull(monotonicNanos, "monotonicNanos must not be null");
    }

    public boolean tryAcquire(UUID endpointId) {
        long now = monotonicNanos.getAsLong();
        if (windows.size() >= MAX_ENDPOINTS && !windows.containsKey(endpointId)) {
            windows.values().removeIf(window -> window.expired(now, windowNanos));
            if (windows.size() >= MAX_ENDPOINTS) {
                // ponytail: fail open past 10k live authenticated endpoints; the global ceiling still applies.
                return true;
            }
        }
        return windows.computeIfAbsent(endpointId, id -> new Window(now)).tryAcquire(now, windowNanos, requestsPerWindow);
    }

    private static final class Window {
        private long startedAt;
        private int accepted;

        Window(long now) {
            this.startedAt = now;
        }

        synchronized boolean expired(long now, long windowNanos) {
            long elapsed = now - startedAt;
            return elapsed < 0 || elapsed >= windowNanos;
        }

        synchronized boolean tryAcquire(long now, long windowNanos, int limit) {
            if (expired(now, windowNanos)) {
                startedAt = now;
                accepted = 0;
            }
            if (accepted >= limit) {
                return false;
            }
            accepted++;
            return true;
        }
    }
}
