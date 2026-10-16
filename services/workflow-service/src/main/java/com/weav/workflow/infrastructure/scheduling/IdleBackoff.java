package com.weav.workflow.infrastructure.scheduling;

import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.LongSupplier;

/**
 * Idle backoff for a fixed-delay poller (Neon scale-to-zero): the scheduler still ticks at the base interval, but
 * after an empty poll the next database poll is skipped. Finding work or {@link #wake()} resets the wait to the
 * base interval. Thread-safe.
 *
 * <p>The wait ramps by doubling up to 60 s (or {@code max} if smaller). Once the next doubling would exceed that
 * ceiling or reach {@code max}, the poller sleeps until an
 * <em>aligned</em> wall-clock instant instead: the first multiple of {@code max} (epoch milliseconds) that is at
 * least {@code max / 2} away, plus a small fixed jitter (at most 2 s). Every poller with the same cap therefore wakes
 * at the same boundaries, so their database touches form one cluster per cap and the compute can suspend in between.
 * A caller that knows when work is next due uses {@link #recordIdle(Duration)}: the poller then skips the ramp and
 * sleeps until the earlier of that instant and the aligned wake.
 */
public final class IdleBackoff {
    private static final Duration MAX_ALLOWED = Duration.ofMinutes(10);
    private static final long MAX_JITTER_MILLIS = 2_000;
    /** The doubling ramp stops here: longer waits would keep the poller waking for minutes after the last work. */
    private static final long RAMP_CEILING_MILLIS = 60_000;
    /** Error retries ramp from the base interval up to this and never take the long aligned sleep. */
    private static final long ERROR_RAMP_CEILING_MILLIS = 32_000;

    private final long baseMillis;
    private final long maxMillis;
    private final LongSupplier nowMillis;
    private final LongSupplier wallClockMillis;
    private final LongSupplier jitterMillis;
    private long currentDelayMillis;
    private long nextPollAtMillis = Long.MIN_VALUE;

    public IdleBackoff(Duration base, Duration max) {
        this(base, max, () -> System.nanoTime() / 1_000_000L);
    }

    IdleBackoff(Duration base, Duration max, LongSupplier nowMillis) {
        this(base, max, nowMillis, System::currentTimeMillis, fixedRandomJitter());
    }

    /** {@code nowMillis} is a monotonic clock for waits, {@code wallClockMillis} epoch time for alignment. */
    IdleBackoff(Duration base, Duration max, LongSupplier nowMillis, LongSupplier wallClockMillis,
                LongSupplier jitterMillis) {
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
        this.currentDelayMillis = baseMillis;
    }

    /** One jitter value per poller, so its wake-ups stay deterministic but pollers do not all collide exactly. */
    private static LongSupplier fixedRandomJitter() {
        long jitter = ThreadLocalRandom.current().nextLong(MAX_JITTER_MILLIS + 1);
        return () -> jitter;
    }

    /** True when the next poll should hit the database. */
    public synchronized boolean shouldPoll() {
        return nowMillis.getAsLong() >= nextPollAtMillis;
    }

    /**
     * Records a poll result: work resets the wait, an empty poll doubles it and, once the next doubling would exceed
     * the 60 s ramp ceiling (or reach the maximum), sleeps until the aligned wake.
     */
    public synchronized void record(boolean foundWork) {
        if (foundWork) {
            wake();
            return;
        }
        if (maxMillis <= baseMillis) {
            nextPollAtMillis = nowMillis.getAsLong() + baseMillis;
            return;
        }
        long doubled = currentDelayMillis * 2;
        boolean ramping = doubled < maxMillis && doubled <= RAMP_CEILING_MILLIS;
        currentDelayMillis = ramping ? doubled : maxMillis;
        long delay = ramping ? doubled : alignedDelayMillis();
        nextPollAtMillis = nowMillis.getAsLong() + delay;
    }

    /**
     * Records an empty poll when the earliest pending due time is known ({@code untilDue}, null when nothing is
     * pending): sleeps until the earlier of that instant (never sooner than the base interval) and the aligned wake.
     */
    public synchronized void recordIdle(Duration untilDue) {
        if (maxMillis <= baseMillis) {
            nextPollAtMillis = nowMillis.getAsLong() + baseMillis;
            return;
        }
        currentDelayMillis = maxMillis;
        long delay = alignedDelayMillis();
        if (untilDue != null) {
            delay = Math.min(delay, Math.max(untilDue.toMillis(), baseMillis));
        }
        nextPollAtMillis = nowMillis.getAsLong() + delay;
    }

    /**
     * Records a failed poll (for example a Neon cold start that timed out): retries from the base interval, doubling
     * up to 32 s on repeated errors. It never takes the aligned wake, even right after one, because a failure says
     * nothing about the database being idle.
     */
    public synchronized void recordError() {
        long ceiling = Math.max(baseMillis, ERROR_RAMP_CEILING_MILLIS);
        if (currentDelayMillis > ceiling) {
            currentDelayMillis = baseMillis;
        }
        nextPollAtMillis = nowMillis.getAsLong() + currentDelayMillis;
        currentDelayMillis = Math.min(currentDelayMillis * 2, ceiling);
    }

    /** Poll at the next tick, e.g. after a local outbox write committed. */
    public synchronized void wake() {
        currentDelayMillis = baseMillis;
        nextPollAtMillis = Long.MIN_VALUE;
    }

    public synchronized long currentDelayMillis() {
        return currentDelayMillis;
    }

    /** Milliseconds until the first multiple of {@code max} (epoch time) at least {@code max / 2} from now. */
    private long alignedDelayMillis() {
        long wall = wallClockMillis.getAsLong();
        long earliest = wall + maxMillis / 2;
        long aligned = Math.ceilDiv(earliest, maxMillis) * maxMillis;
        long jitter = Math.max(0, Math.min(jitterMillis.getAsLong(), MAX_JITTER_MILLIS));
        return aligned - wall + jitter;
    }
}
