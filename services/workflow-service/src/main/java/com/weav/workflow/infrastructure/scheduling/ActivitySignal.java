package com.weav.workflow.infrastructure.scheduling;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.concurrent.atomic.AtomicLong;

/**
 * In-process "new work was committed" signal for several independent pollers: each consumer remembers the last
 * generation it saw, so one signal wakes all of them (unlike {@link OutboxWakeup}, which has a single consumer).
 */
public final class ActivitySignal {
    private final AtomicLong generation = new AtomicLong();

    /** Bumps the generation once the current transaction commits (immediately when there is none). */
    public void signalAfterCommit() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    generation.incrementAndGet();
                }
            });
        } else {
            generation.incrementAndGet();
        }
    }

    public long generation() {
        return generation.get();
    }
}
