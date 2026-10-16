package com.weav.workflow.infrastructure.scheduling;

import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class IdleBackoffTest {
    private static final long CAP = 600_000;
    /** A quarter of the way into a cap window, so the aligned boundary is unambiguous. */
    private static final long START = 3 * CAP + 150_000;

    private final AtomicLong now = new AtomicLong(START);
    private final AtomicLong jitter = new AtomicLong();
    private final IdleBackoff backoff = backoff(Duration.ofSeconds(1), Duration.ofMillis(CAP));

    private IdleBackoff backoff(Duration base, Duration max) {
        return new IdleBackoff(base, max, now::get, now::get, jitter::get);
    }

    /** First multiple of the cap that is at least half a cap away from the given wall-clock time. */
    private static long aligned(long wall) {
        return Math.ceilDiv(wall + CAP / 2, CAP) * CAP;
    }

    @Test
    void emptyPollsDoubleUpToTheRampCeilingThenSleepUntilTheAlignedWake() {
        assertTrue(backoff.shouldPoll());
        long[] ramp = {2_000, 4_000, 8_000, 16_000, 32_000};
        for (long delay : ramp) {
            backoff.record(false);
            assertEquals(delay, backoff.currentDelayMillis());
            now.addAndGet(delay - 1);
            assertFalse(backoff.shouldPoll(), "still backing off at " + delay);
            now.incrementAndGet();
            assertTrue(backoff.shouldPoll(), "due again after " + delay);
        }

        backoff.record(false); // 64 s would exceed the 60 s ramp ceiling: aligned wake instead
        long wake = aligned(now.get());
        assertEquals(CAP, backoff.currentDelayMillis());
        now.set(wake - 1);
        assertFalse(backoff.shouldPoll());
        now.set(wake);
        assertTrue(backoff.shouldPoll());
    }

    @Test
    void anAlignedWakeNeverSleepsLessThanHalfTheCapAndAllPollersLandOnTheSameBoundary() {
        IdleBackoff early = backoff(Duration.ofSeconds(1), Duration.ofMillis(CAP));
        early.recordIdle(null);
        long boundary = aligned(START);
        assertTrue(boundary - START >= CAP / 2);
        now.set(boundary - 1);
        assertFalse(early.shouldPoll());
        now.set(boundary);
        assertTrue(early.shouldPoll());

        // Just before a boundary (less than half a cap away) the poller skips it and takes the next one.
        now.set(boundary + CAP - 1_000);
        IdleBackoff late = backoff(Duration.ofSeconds(1), Duration.ofMillis(CAP));
        late.recordIdle(null);
        now.set(boundary + CAP);
        assertFalse(late.shouldPoll());
        now.set(boundary + 2 * CAP);
        assertTrue(late.shouldPoll());

        // Another poller that went idle a minute after the first one wakes at the very same boundary.
        now.set(START + 60_000);
        IdleBackoff other = backoff(Duration.ofSeconds(30), Duration.ofMillis(CAP));
        other.recordIdle(null);
        now.set(boundary - 1);
        assertFalse(other.shouldPoll());
        now.set(boundary);
        assertTrue(other.shouldPoll());
    }

    @Test
    void anIdlePollerSleepsUntilTheEarliestKnownDueTimeWhenItIsBeforeTheAlignedWake() {
        backoff.recordIdle(Duration.ofSeconds(90));
        now.addAndGet(89_999);
        assertFalse(backoff.shouldPoll());
        now.incrementAndGet();
        assertTrue(backoff.shouldPoll());

        // A due time past the aligned wake does not postpone it.
        now.set(START);
        backoff.recordIdle(Duration.ofHours(5));
        now.set(aligned(START));
        assertTrue(backoff.shouldPoll());
    }

    @Test
    void aDueTimeInThePastIsClampedToTheBaseInterval() {
        backoff.recordIdle(Duration.ofSeconds(-30));
        now.addAndGet(999);
        assertFalse(backoff.shouldPoll());
        now.incrementAndGet();
        assertTrue(backoff.shouldPoll());
    }

    @Test
    void jitterShiftsTheAlignedWakeByAtMostTwoSeconds() {
        jitter.set(1_500);
        backoff.recordIdle(null);
        now.set(aligned(START) + 1_499);
        assertFalse(backoff.shouldPoll());
        now.incrementAndGet();
        assertTrue(backoff.shouldPoll());

        now.set(START);
        jitter.set(60_000);
        backoff.recordIdle(null);
        now.set(aligned(START) + 2_000);
        assertTrue(backoff.shouldPoll(), "jitter is capped at two seconds");
        now.set(aligned(START) + 1_999);
        assertFalse(backoff.shouldPoll());
    }

    @Test
    void aSmallCapRampsToItsOwnCeilingBeforeAligning() {
        IdleBackoff small = backoff(Duration.ofSeconds(1), Duration.ofSeconds(30));
        long[] ramp = {2_000, 4_000, 8_000, 16_000};
        for (long delay : ramp) {
            small.record(false);
            assertEquals(delay, small.currentDelayMillis());
        }
        small.record(false); // 32 s would reach past the 30 s cap
        assertEquals(30_000, small.currentDelayMillis());
    }

    @Test
    void workResetsToTheBaseIntervalAndPollsAtTheNextTick() {
        backoff.record(false);
        backoff.record(false);
        assertEquals(4_000, backoff.currentDelayMillis());

        backoff.record(true);

        assertEquals(1_000, backoff.currentDelayMillis());
        assertTrue(backoff.shouldPoll());
        backoff.record(false);
        assertEquals(2_000, backoff.currentDelayMillis());
    }

    @Test
    void wakeEndsTheBackoffImmediately() {
        for (int i = 0; i < 7; i++) {
            backoff.record(false);
        }
        assertFalse(backoff.shouldPoll());

        backoff.wake();

        assertTrue(backoff.shouldPoll());
        assertEquals(1_000, backoff.currentDelayMillis());
    }

    @Test
    void rejectsInvalidBounds() {
        assertThrows(IllegalArgumentException.class, () -> new IdleBackoff(Duration.ZERO, Duration.ofSeconds(1)));
        assertThrows(IllegalArgumentException.class,
                () -> new IdleBackoff(Duration.ofSeconds(2), Duration.ofSeconds(1)));
        assertThrows(IllegalArgumentException.class,
                () -> new IdleBackoff(Duration.ofSeconds(1), Duration.ofMinutes(11)));
    }

    @Test
    void aBaseAboveTheCeilingIsAcceptedAndNeverGrows() {
        IdleBackoff slow = new IdleBackoff(Duration.ofHours(1), Duration.ofHours(1), now::get, now::get, jitter::get);
        slow.record(false);
        assertEquals(3_600_000, slow.currentDelayMillis());
    }

    @Test
    void wakeupIsRaisedOnlyAfterCommit() {
        OutboxWakeup wakeup = new OutboxWakeup();
        TransactionSynchronizationManager.initSynchronization();
        try {
            wakeup.signalAfterCommit();
            assertFalse(wakeup.consume(), "not visible before the commit");
            TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
        assertTrue(wakeup.consume());
        assertFalse(wakeup.consume(), "consume clears the signal");

        wakeup.signalAfterCommit();
        assertTrue(wakeup.consume(), "without a transaction the signal is immediate");
    }

    @Test
    void anErrorAfterAnAlignedSleepRetriesFromTheBaseIntervalAndNeverAligns() {
        backoff.recordIdle(null); // success-idle: aligned sleep of 5+ minutes
        assertFalse(backoff.shouldPoll());

        backoff.recordError(); // e.g. the cold-started database timed out

        now.addAndGet(999);
        assertFalse(backoff.shouldPoll());
        now.incrementAndGet();
        assertTrue(backoff.shouldPoll(), "retry one base interval after the error, not at the next boundary");

        long[] ramp = {2_000, 4_000, 8_000, 16_000, 32_000, 32_000};
        for (long delay : ramp) {
            backoff.recordError();
            now.addAndGet(delay - 1);
            assertFalse(backoff.shouldPoll());
            now.incrementAndGet();
            assertTrue(backoff.shouldPoll(), "error retry after " + delay);
        }
    }
}
