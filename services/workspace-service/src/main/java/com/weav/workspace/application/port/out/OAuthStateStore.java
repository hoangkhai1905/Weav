package com.weav.workspace.application.port.out;

import com.weav.workspace.application.dto.OAuthPendingState;

import java.util.Objects;
import java.util.Optional;

/** One-time, expiring OAuth state storage. Implementations must fail closed. */
public interface OAuthStateStore {

    /** Saves the legacy four-field callback state without notification-origin metadata. */
    void save(String state, OAuthPendingState pendingState);

    /**
     * Saves callback state and notification-origin metadata together. The status argument must
     * come from the current Connection read inside the final locked start transaction.
     */
    void saveForStart(String state, OAuthPendingState pendingState, boolean activeAtLockedStart);

    /** Atomically consumes callback state and its optional notification-origin metadata. */
    Optional<ConsumedState> consumeForCallback(String state);

    /** Best-effort release of an active-origin lease after callback processing; TTL is the fallback. */
    void releaseOrigin(ConsumedState consumedState);

    /** Compatibility view for callers that only need the original pending callback fields. */
    default Optional<OAuthPendingState> consume(String state) {
        return consumeForCallback(state).map(consumedState -> {
            releaseOrigin(consumedState);
            return consumedState.pendingState();
        });
    }

    enum NotificationOrigin {
        ACTIVE,
        NON_ACTIVE,
        UNKNOWN
    }

    record ConsumedState(
            OAuthPendingState pendingState,
            NotificationOrigin notificationOrigin,
            String originReference) {
        public ConsumedState {
            Objects.requireNonNull(pendingState, "pendingState must not be null");
            Objects.requireNonNull(notificationOrigin, "notificationOrigin must not be null");
            if ((notificationOrigin == NotificationOrigin.ACTIVE) != (originReference != null)) {
                throw new IllegalArgumentException("originReference must exist only for ACTIVE origin");
            }
        }
    }
}
