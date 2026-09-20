package com.weav.workspace.application.port.out;

import com.weav.workspace.application.dto.OAuthPendingState;

import java.util.Optional;

/** One-time, expiring OAuth state storage. Implementations must fail closed. */
public interface OAuthStateStore {

    void save(String state, OAuthPendingState pendingState);

    Optional<OAuthPendingState> consume(String state);
}
