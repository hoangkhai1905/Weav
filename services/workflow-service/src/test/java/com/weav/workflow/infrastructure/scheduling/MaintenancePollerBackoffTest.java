package com.weav.workflow.infrastructure.scheduling;

import com.weav.workflow.application.port.out.ExecutionRecoveryPort;
import com.weav.workflow.application.service.AlertEvaluator;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Duration;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Recovery scanner and long-running sweep back off only while no run is in flight; admissions wake them. */
class MaintenancePollerBackoffTest {

    @Test
    void recoveryBacksOffWhenIdleStaysAtBaseWhileRunsAreActiveAndWakesOnAdmission() {
        ExecutionRecoveryPort recovery = mock(ExecutionRecoveryPort.class);
        when(recovery.enqueueRecoverable(anyInt(), any(), any())).thenReturn(0);
        when(recovery.hasActiveExecutions()).thenReturn(true, true, false);
        ActivitySignal activity = new ActivitySignal();
        ExecutionRecoveryScanner scanner = new ExecutionRecoveryScanner(recovery, 50, Duration.ofMinutes(1),
                Duration.ofMinutes(1));
        scanner.configureIdleBackoff(Duration.ofSeconds(30), Duration.ofMinutes(10), activity);

        scanner.recoverOnSchedule(); // active runs: stays at base
        scanner.recoverOnSchedule(); // active runs: stays at base
        scanner.recoverOnSchedule(); // idle: starts backing off
        scanner.recoverOnSchedule(); // skipped
        verify(recovery, times(3)).enqueueRecoverable(anyInt(), any(), any());

        activity.signalAfterCommit();
        scanner.recoverOnSchedule(); // woken by a local admission
        verify(recovery, times(4)).enqueueRecoverable(anyInt(), any(), any());
        scanner.scanNow(); // direct scans are never gated
        verify(recovery, times(5)).enqueueRecoverable(anyInt(), any(), any());
    }

    @Test
    void sweepBacksOffWhileNothingRunsAndWakesOnAdmission() {
        AlertEvaluator evaluator = mock(AlertEvaluator.class);
        ExecutionRecoveryPort executions = mock(ExecutionRecoveryPort.class);
        when(executions.hasActiveExecutions()).thenReturn(false);
        ActivitySignal activity = new ActivitySignal();
        LongRunningAlertSweeper sweeper = new LongRunningAlertSweeper(evaluator, 200);
        sweeper.configureIdleBackoff(Duration.ofSeconds(60), Duration.ofMinutes(10), activity, executions);

        sweeper.sweepOnSchedule();
        sweeper.sweepOnSchedule();
        verify(evaluator, times(1)).sweepOverdue(200);

        TransactionSynchronizationManager.initSynchronization();
        try {
            activity.signalAfterCommit();
            sweeper.sweepOnSchedule();
            verify(evaluator, times(1)).sweepOverdue(200); // not before the admission commits
            TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
        sweeper.sweepOnSchedule();
        verify(evaluator, times(2)).sweepOverdue(200);
    }
}
