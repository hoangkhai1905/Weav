package com.weav.workflow.infrastructure.execution;

import com.weav.workflow.application.port.out.RetryWaitPort;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Implements persisted retry waits without retaining a database transaction or node permit. */
@Component
public final class ScheduledRetryWait implements RetryWaitPort {
    private final Clock clock;
    private final ScheduledExecutorService scheduler;

    public ScheduledRetryWait(@Qualifier("workflowExecutionClock") Clock clock,
                              @Qualifier("workflowExecutionTimer") ScheduledExecutorService scheduler) {
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
        this.scheduler = Objects.requireNonNull(scheduler, "scheduler must not be null");
    }

    @Override
    public CompletionStage<Void> until(Instant eligibleAt) {
        Objects.requireNonNull(eligibleAt, "eligibleAt must not be null");
        long delayMillis = Math.max(0L, Duration.between(clock.instant(), eligibleAt).toMillis());
        CompletableFuture<Void> result = new CompletableFuture<>();
        try {
            scheduler.schedule(() -> result.complete(null), delayMillis, TimeUnit.MILLISECONDS);
        } catch (RuntimeException exception) {
            result.completeExceptionally(new IllegalStateException("Retry wait could not be scheduled"));
        }
        return result;
    }
}
