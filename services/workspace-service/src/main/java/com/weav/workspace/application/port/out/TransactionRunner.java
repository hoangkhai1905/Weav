package com.weav.workspace.application.port.out;

import java.util.Objects;
import java.util.function.Supplier;

/** Runs one application operation in a transaction boundary. */
public interface TransactionRunner {

    <T> T required(Supplier<T> work);

    /**
     * Reports whether the current thread already owns an ambient transaction.
     * Implementations that cannot observe infrastructure transaction state
     * retain the safe no-ambient default used by in-memory test runners.
     */
    default boolean hasAmbientTransaction() {
        return false;
    }

    /**
     * Runs work in a new transaction even when the caller already has one.
     * Create retries use this boundary so a rolled-back attempt cannot poison
     * the next attempt.
     */
    <T> T requiresNew(Supplier<T> work);

    static <T> T requireResult(T result) {
        return Objects.requireNonNull(result, "transaction result must not be null");
    }
}
