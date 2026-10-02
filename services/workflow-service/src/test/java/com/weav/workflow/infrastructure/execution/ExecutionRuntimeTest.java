package com.weav.workflow.infrastructure.execution;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ThreadPoolExecutor;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ExecutionRuntimeTest {

    @Test
    void usesBoundedNodeAndTimerPools() {
        BoundedExecutionConfiguration configuration = new BoundedExecutionConfiguration();
        ThreadPoolExecutor nodes = configuration.workflowExecutionExecutor(2, 3);
        ScheduledExecutorService timer = configuration.workflowExecutionTimer(1);
        try {
            assertTrue(nodes.getQueue().remainingCapacity() >= 3);
            assertTrue(timer.submit(() -> true).get(1, TimeUnit.SECONDS));
        } catch (Exception exception) {
            throw new AssertionError("bounded runtime resources did not execute", exception);
        } finally {
            nodes.shutdownNow();
            timer.shutdownNow();
        }
    }

    @Test
    void rejectsUnboundedRuntimePools() {
        BoundedExecutionConfiguration configuration = new BoundedExecutionConfiguration();
        assertThrows(IllegalArgumentException.class,
                () -> configuration.workflowExecutionExecutor(0, 3));
        assertThrows(IllegalArgumentException.class,
                () -> configuration.workflowExecutionExecutor(2, 0));
        assertThrows(IllegalArgumentException.class,
                () -> configuration.workflowExecutionTimer(17));
    }

    @Test
    void retryWaitUsesTheRuntimeTimerWithoutHoldingARepositoryTransaction() throws Exception {
        ScheduledExecutorService timer = java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
        try {
            Instant now = Instant.parse("2026-09-22T00:00:00Z");
            ScheduledRetryWait wait = new ScheduledRetryWait(Clock.fixed(now, ZoneOffset.UTC), timer);
            wait.until(now).toCompletableFuture().get(1, TimeUnit.SECONDS);
        } finally {
            timer.shutdownNow();
        }
    }
}
