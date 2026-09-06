package com.weav.identity.infrastructure.security;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

@Component
public final class AuthRateLimiter {

    static final int DEFAULT_MAX_ENTRIES = 10_000;

    private final Clock clock;
    private final int maxEntries;
    private final Map<LimitKey, WindowCounter> counters = new HashMap<>();

    @Autowired
    public AuthRateLimiter(Clock clock) {
        this(clock, DEFAULT_MAX_ENTRIES);
    }

    AuthRateLimiter(Clock clock, int maxEntries) {
        this.clock = Objects.requireNonNull(clock);
        if (maxEntries < 1) {
            throw new IllegalArgumentException("maxEntries must be positive");
        }
        this.maxEntries = maxEntries;
    }

    public void requireAllowed(Scope scope, String key) {
        Decision decision = attempt(scope, key);
        if (!decision.allowed()) {
            throw new AuthRateLimitExceededException(decision.retryAfterSeconds());
        }
    }

    synchronized Decision attempt(Scope scope, String key) {
        Objects.requireNonNull(scope);
        String normalizedKey = key == null || key.isBlank() ? "unknown" : key;
        Instant now = clock.instant();
        counters.entrySet().removeIf(entry -> !now.isBefore(entry.getValue().expiresAt()));

        LimitKey limitKey = new LimitKey(scope, normalizedKey);
        WindowCounter current = counters.get(limitKey);
        if (current == null) {
            if (counters.size() >= maxEntries) {
                return Decision.blocked(secondsUntilNextCapacity(now));
            }
            counters.put(limitKey, new WindowCounter(1, now.plus(scope.window())));
            return Decision.permitted();
        }

        if (current.count() >= scope.limit()) {
            return Decision.blocked(secondsBetweenCeiling(now, current.expiresAt()));
        }
        counters.put(limitKey, new WindowCounter(current.count() + 1, current.expiresAt()));
        return Decision.permitted();
    }

    synchronized int entryCount() {
        return counters.size();
    }

    private long secondsUntilNextCapacity(Instant now) {
        return counters.values().stream()
                .mapToLong(counter -> secondsBetweenCeiling(now, counter.expiresAt()))
                .min()
                .orElse(1);
    }

    private static long secondsBetweenCeiling(Instant start, Instant end) {
        long millis = Math.max(1, Duration.between(start, end).toMillis());
        return Math.max(1, (millis + 999) / 1_000);
    }

    public enum Scope {
        REGISTER_IP(5, Duration.ofMinutes(1)),
        LOGIN_IP(20, Duration.ofMinutes(1)),
        REFRESH_IP(30, Duration.ofMinutes(1)),
        LOGIN_ACCOUNT(10, Duration.ofMinutes(15));

        private final int limit;
        private final Duration window;

        Scope(int limit, Duration window) {
            this.limit = limit;
            this.window = window;
        }

        int limit() {
            return limit;
        }

        Duration window() {
            return window;
        }
    }

    record Decision(boolean allowed, long retryAfterSeconds) {

        static Decision permitted() {
            return new Decision(true, 0);
        }

        static Decision blocked(long retryAfterSeconds) {
            return new Decision(false, Math.max(1, retryAfterSeconds));
        }
    }

    private record LimitKey(Scope scope, String value) {
    }

    private record WindowCounter(int count, Instant expiresAt) {
    }
}
