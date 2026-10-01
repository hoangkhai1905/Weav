package com.weav.workspace.application.port.out;

import java.util.Objects;
import java.util.Optional;

/**
 * Short-lived, single-use holder of a Google authorization code that has been received by the
 * public callback but not yet bound to an authenticated user. Implementations must fail closed.
 */
public interface OAuthCompletionStore {

    void save(String completionId, PendingCompletion completion);

    /** Atomically reads and deletes the record; a second call for the same id returns empty. */
    Optional<PendingCompletion> consume(String completionId);

    /** The authorization code is a secret; it is never part of {@link #toString()}. */
    record PendingCompletion(OAuthStateStore.ConsumedState consumedState, String authorizationCode) {
        public PendingCompletion {
            Objects.requireNonNull(consumedState, "consumedState must not be null");
            Objects.requireNonNull(authorizationCode, "authorizationCode must not be null");
        }

        @Override
        public String toString() {
            return "PendingCompletion[consumedState=" + consumedState + ", authorizationCode=<redacted>]";
        }
    }
}
