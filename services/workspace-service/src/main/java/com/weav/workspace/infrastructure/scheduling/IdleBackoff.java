package com.weav.workspace.infrastructure.scheduling;

import java.time.Duration;
import java.util.Objects;
import java.util.function.LongSupplier;

/**
 * Idle backoff for a fixed-delay poller (Neon scale-to-zero): the scheduler still ticks at the base interval, but
 * after an empty poll the next database poll is skipped until the wait has doubled, up to {@code max}. Finding work
 * or {@link #wake()} resets the wait to the base interval. Thread-safe.
 */
public final class IdleBackoff {
    private static final Duration MAX_ALLOWED = Duration.ofMinutes(10);

    private final long baseMillis;
    private final long maxMillis;
    private final LongSupplier nowMillis;
    private long currentDelayMillis;
    private long nextPollAtMillis = Long.MIN_VALUE;

    public IdleBackoff(Duration base, Duration max) {
        this(base, max, () -> System.nanoTime() / 1_000_000L);
    }

    IdleBackoff(Duration base, Duration max, LongSupplier nowMillis) {
        Objects.requireNonNull(base, "base must not be null");
        Objects.requireNonNull(max, "max must not be null");
        if (base.toMillis() < 1 || max.compareTo(base) < 0 || max.compareTo(MAX_ALLOWED) > 0) {
            throw new IllegalArgumentException("Idle backoff needs 1 ms <= base <= max <= 10 minutes");
        }
        this.baseMillis = base.toMillis();
        this.maxMillis = max.toMillis();
        this.nowMillis = Objects.requireNonNull(nowMillis, "nowMillis must not be null");
        this.currentDelayMillis = baseMillis;
    }

    /** True when the next poll should hit the database. */
    public synchronized boolean shouldPoll() {
        return nowMillis.getAsLong() >= nextPollAtMillis;
    }

    /** Records a poll result: work resets the wait, an empty poll doubles it up to the maximum. */
    public synchronized void record(boolean foundWork) {
        if (foundWork) {
            currentDelayMillis = baseMillis;
            nextPollAtMillis = Long.MIN_VALUE;
            return;
        }
        currentDelayMillis = Math.min(currentDelayMillis * 2, maxMillis);
        nextPollAtMillis = nowMillis.getAsLong() + currentDelayMillis;
    }

    /** Poll at the next tick, e.g. after a local outbox write committed. */
    public synchronized void wake() {
        currentDelayMillis = baseMillis;
        nextPollAtMillis = Long.MIN_VALUE;
    }

    public synchronized long currentDelayMillis() {
        return currentDelayMillis;
    }
}
