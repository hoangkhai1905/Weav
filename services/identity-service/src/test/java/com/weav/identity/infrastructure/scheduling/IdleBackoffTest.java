package com.weav.identity.infrastructure.scheduling;

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
}
