package com.weav.workflow.application.port.out;

import java.time.Instant;
import java.util.concurrent.CompletionStage;

/** Waits for a persisted retry eligibility time without holding a database transaction. */
@FunctionalInterface
public interface RetryWaitPort {
    CompletionStage<Void> until(Instant eligibleAt);
}
