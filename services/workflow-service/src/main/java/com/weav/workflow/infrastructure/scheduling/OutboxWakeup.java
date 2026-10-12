package com.weav.workflow.infrastructure.scheduling;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * In-process "an outbox row was committed" signal, so an idle publisher polls at its next tick instead of waiting
 * out its backoff. Only this instance is woken; other instances still find the row on their own backoff schedule.
 */
public final class OutboxWakeup {
    private final AtomicBoolean pending = new AtomicBoolean();

    /** Raises the signal once the current transaction commits (immediately when there is none). */
    public void signalAfterCommit() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    pending.set(true);
                }
            });
        } else {
            pending.set(true);
        }
    }

    /** Returns and clears the signal. */
    public boolean consume() {
        return pending.getAndSet(false);
    }
}
