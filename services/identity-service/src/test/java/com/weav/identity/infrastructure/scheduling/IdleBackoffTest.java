package com.weav.identity.infrastructure.scheduling;

import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class IdleBackoffTest {
    private final AtomicLong now = new AtomicLong(1_000_000);
    private final IdleBackoff backoff = new IdleBackoff(Duration.ofSeconds(1), Duration.ofSeconds(30), now::get);

    @Test
    void emptyPollsDoubleTheWaitUpToTheCap() {
        assertTrue(backoff.shouldPoll());
        long[] expected = {2_000, 4_000, 8_000, 16_000, 30_000, 30_000};
        for (long delay : expected) {
            backoff.record(false);
            assertEquals(delay, backoff.currentDelayMillis());
            now.addAndGet(delay - 1);
            assertFalse(backoff.shouldPoll(), "still backing off at " + delay);
            now.incrementAndGet();
            assertTrue(backoff.shouldPoll(), "due again after " + delay);
        }
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
        for (int i = 0; i < 6; i++) {
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
        IdleBackoff slow = new IdleBackoff(Duration.ofHours(1), Duration.ofHours(1), now::get);
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

    // ---- aligned idle wake (Neon scale-to-zero) ----

    private static final long TEN_MINUTES = 600_000;

    /** One fake clock drives both the monotonic and the epoch wall clock; jitter is fixed. */
    private IdleBackoff aligned(long jitterMillis) {
        return new IdleBackoff(Duration.ofSeconds(1), Duration.ofMinutes(10), now::get, now::get, () -> jitterMillis);
    }

    private long wakeDelay(IdleBackoff backoff) {
        long start = now.get();
        long low = 0;
        long high = 2 * TEN_MINUTES;
        while (low < high) {
            long mid = (low + high) / 2;
            now.set(start + mid);
            if (backoff.shouldPoll()) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }
        now.set(start);
        return low;
    }

    @Test
    void rampStopsAtSixtySecondsThenLandsOnAnAlignedMultipleOfTheCap() {
        now.set(5 * TEN_MINUTES + 123_456);
        IdleBackoff backoff = aligned(0);
        long[] ramp = {2_000, 4_000, 8_000, 16_000, 32_000};
        for (long delay : ramp) {
            backoff.record(false);
            assertEquals(delay, wakeDelay(backoff));
        }

        backoff.record(false);

        assertEquals(TEN_MINUTES, backoff.currentDelayMillis());
        long wake = now.get() + wakeDelay(backoff);
        assertEquals(0, wake % TEN_MINUTES, "aligned to a multiple of the cap");
        assertTrue(wake - now.get() >= TEN_MINUTES / 2, "at least half a cap away");
        assertTrue(wake - now.get() < TEN_MINUTES + TEN_MINUTES / 2);
    }

    @Test
    void pollersWithTheSameCapWakeInTheSameWindowWhateverTheirPhase() {
        long base = 7 * TEN_MINUTES;
        long[] phasesForNextMultiple = {0, 1, 299_999, 300_000};
        for (long phase : phasesForNextMultiple) {
            now.set(base + phase);
            IdleBackoff backoff = aligned(0);
            backoff.record(false, null);
            assertEquals(base + TEN_MINUTES, now.get() + wakeDelay(backoff), "phase " + phase);
        }
        for (long phase : new long[] {300_001, 599_999}) {
            now.set(base + phase);
            IdleBackoff backoff = aligned(0);
            backoff.record(false, null);
            assertEquals(base + 2 * TEN_MINUTES, now.get() + wakeDelay(backoff), "phase " + phase);
        }
    }

    @Test
    void jitterShiftsTheAlignedWakeByAtMostTwoSecondsAndIsClamped() {
        now.set(3 * TEN_MINUTES);
        long plain = wakeDelayAfterIdle(aligned(0));
        assertEquals(plain + 1_500, wakeDelayAfterIdle(aligned(1_500)));
        assertEquals(plain + 2_000, wakeDelayAfterIdle(aligned(60_000)), "clamped to 2 s");
        assertEquals(plain, wakeDelayAfterIdle(aligned(-5)), "negative jitter is ignored");
    }

    private long wakeDelayAfterIdle(IdleBackoff backoff) {
        backoff.record(false, null);
        return wakeDelay(backoff);
    }

    @Test
    void emptyTableSleepsStraightToTheAlignedCapWithoutRamping() {
        now.set(2 * TEN_MINUTES + 1);
        IdleBackoff backoff = aligned(0);

        backoff.record(false, null);

        assertEquals(TEN_MINUTES - 1, wakeDelay(backoff));
    }

    @Test
    void sleepsUntilTheEarliestKnownDueTimeWhenItIsBeforeTheCap() {
        now.set(4 * TEN_MINUTES);
        IdleBackoff backoff = aligned(0);

        backoff.record(false, Instant.ofEpochMilli(now.get() + 90_000));

        assertEquals(90_000, wakeDelay(backoff));
    }

    @Test
    void aDueTimeBeyondTheCapDoesNotPostponeTheAlignedWake() {
        now.set(4 * TEN_MINUTES);
        IdleBackoff backoff = aligned(0);

        backoff.record(false, Instant.ofEpochMilli(now.get() + 3 * TEN_MINUTES));

        assertEquals(TEN_MINUTES, wakeDelay(backoff));
    }

    @Test
    void anOverdueDueTimeIsClampedToOneBaseIntervalSoThePollerNeverSpins() {
        now.set(4 * TEN_MINUTES);
        IdleBackoff backoff = aligned(0);

        backoff.record(false, Instant.ofEpochMilli(now.get() - 60_000));

        assertEquals(1_000, wakeDelay(backoff));
    }

    @Test
    void wakeAndWorkStillResetToTheBaseAfterAnAlignedSleep() {
        now.set(4 * TEN_MINUTES + 17);
        IdleBackoff backoff = aligned(0);
        backoff.record(false, null);
        assertFalse(backoff.shouldPoll());

        backoff.wake();
        assertTrue(backoff.shouldPoll());
        assertEquals(1_000, backoff.currentDelayMillis());

        backoff.record(false, null);
        backoff.record(true, null);
        assertTrue(backoff.shouldPoll());
        assertEquals(1_000, backoff.currentDelayMillis());
    }

    @Test
    void aPollerWithoutBackoffRoomIsNotAligned() {
        IdleBackoff flat = new IdleBackoff(Duration.ofSeconds(30), Duration.ofSeconds(30), now::get, now::get, () -> 0);
        flat.record(false, null);
        assertEquals(30_000, wakeDelay(flat));
    }
}
