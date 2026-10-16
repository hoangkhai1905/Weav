package com.weav.identity.infrastructure.scheduling;

import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.LongSupplier;

/**
 * Idle backoff for a fixed-delay poller (Neon scale-to-zero): the scheduler still ticks at the base interval, but
 * after an empty poll the next database poll is skipped until the wait has doubled, up to {@code max} (up to 60 s
 * when aligned, see below). Finding work
 * or {@link #wake()} resets the wait to the base interval. Thread-safe.
 *
 * <p>Aligned idle wake: the services share one Neon compute that suspends after ~5 idle minutes, so idle pollers
 * must wake together, not spread out. Once the doubling would exceed min({@code max}, 60 s), the next poll lands on the first multiple of
 * {@code max} on the epoch wall clock that is at least {@code max/2} away (plus a small fixed per-instance jitter),
 * so every poller with the same cap wakes in the same short window. A poller that inspected its table can also pass
 * the earliest pending due time ({@link #record(boolean, Instant)}) and sleeps until then instead of ramping.
 */
public final class IdleBackoff {
    private static final Duration MAX_ALLOWED = Duration.ofMinutes(10);
    private static final long MAX_JITTER_MILLIS = 2_000;
    /** The aligned wake takes over once the doubling would exceed this (a 255 s gap would keep Neon awake). */
    private static final long RAMP_CEILING_MILLIS = 60_000;

    private final long baseMillis;
    private final long maxMillis;
    private final LongSupplier nowMillis;
    private final LongSupplier wallClockMillis;
    private final LongSupplier jitterMillis;
    private final boolean aligned;
    private long currentDelayMillis;
    private long nextPollAtMillis = Long.MIN_VALUE;

    public IdleBackoff(Duration base, Duration max) {
        // One fixed jitter per instance keeps the pollers of a cluster within 2 s of each other.
        this(base, max, () -> System.nanoTime() / 1_000_000L, System::currentTimeMillis,
                constantJitter(ThreadLocalRandom.current().nextLong(MAX_JITTER_MILLIS + 1)), true);
    }

    /** Plain ramp on a monotonic clock, no wall-clock alignment and no jitter. */
    IdleBackoff(Duration base, Duration max, LongSupplier nowMillis) {
        this(base, max, nowMillis, System::currentTimeMillis, () -> 0L, false);
    }

    /** Aligned idle wake; {@code wallClockMillis} is epoch millis, {@code jitterMillis} is clamped to 0..2000. */
    IdleBackoff(Duration base, Duration max, LongSupplier nowMillis, LongSupplier wallClockMillis,
            LongSupplier jitterMillis) {
        this(base, max, nowMillis, wallClockMillis, jitterMillis, true);
    }

    private IdleBackoff(Duration base, Duration max, LongSupplier nowMillis, LongSupplier wallClockMillis,
            LongSupplier jitterMillis, boolean aligned) {
        Objects.requireNonNull(base, "base must not be null");
        Objects.requireNonNull(max, "max must not be null");
        // A base above the ceiling (a poller effectively switched off, e.g. in tests) simply never backs off.
        if (base.toMillis() < 1 || max.compareTo(base) < 0
                || max.compareTo(MAX_ALLOWED) > 0 && max.compareTo(base) > 0) {
            throw new IllegalArgumentException("Idle backoff needs 1 ms <= base <= max <= max(base, 10 minutes)");
        }
        this.baseMillis = base.toMillis();
        this.maxMillis = max.toMillis();
        this.nowMillis = Objects.requireNonNull(nowMillis, "nowMillis must not be null");
        this.wallClockMillis = Objects.requireNonNull(wallClockMillis, "wallClockMillis must not be null");
        this.jitterMillis = Objects.requireNonNull(jitterMillis, "jitterMillis must not be null");
        // A poller that never backs off (max == base) has nothing to align.
        this.aligned = aligned && maxMillis > baseMillis;
        this.currentDelayMillis = baseMillis;
    }

    /** True when the next poll should hit the database. */
    public synchronized boolean shouldPoll() {
        return nowMillis.getAsLong() >= nextPollAtMillis;
    }

    /** Records a poll result: work resets the wait, an empty poll doubles it up to the maximum, then aligns. */
    public synchronized void record(boolean foundWork) {
        if (foundWork) {
            currentDelayMillis = baseMillis;
            nextPollAtMillis = Long.MIN_VALUE;
            return;
        }
        long doubled = currentDelayMillis * 2;
        long delay;
        if (aligned && doubled > Math.min(maxMillis, RAMP_CEILING_MILLIS)) {
            currentDelayMillis = maxMillis;
            delay = alignedDelayMillis();
        } else {
            currentDelayMillis = Math.min(doubled, maxMillis);
            delay = currentDelayMillis;
        }
        nextPollAtMillis = nowMillis.getAsLong() + delay;
    }

    /**
     * Records a poll that inspected the table: work resets the wait; otherwise the next poll is at
     * {@code min(earliestKnownDue, aligned cap)} with the ramp skipped, because nothing can be due earlier
     * (local writes still {@link #wake()}). {@code earliestKnownDue} is the earliest pending row's due time, or
     * null when nothing is pending; it is clamped to at least one base interval from now.
     */
    public synchronized void record(boolean foundWork, Instant earliestKnownDue) {
        if (foundWork) {
            record(true);
            return;
        }
        currentDelayMillis = maxMillis;
        long delay = aligned ? alignedDelayMillis() : maxMillis;
        if (earliestKnownDue != null) {
            long untilDue = earliestKnownDue.toEpochMilli() - wallClockMillis.getAsLong();
            delay = Math.min(delay, Math.max(untilDue, baseMillis));
        }
        nextPollAtMillis = nowMillis.getAsLong() + delay;
    }

    /** First multiple of max on the epoch wall clock that is at least max/2 from now, plus jitter, as a delay. */
    private long alignedDelayMillis() {
        long wall = wallClockMillis.getAsLong();
        long wake = Math.ceilDiv(wall + maxMillis / 2, maxMillis) * maxMillis;
        long jitter = Math.max(0, Math.min(jitterMillis.getAsLong(), MAX_JITTER_MILLIS));
        return wake + jitter - wall;
    }

    private static LongSupplier constantJitter(long millis) {
        return () -> millis;
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
