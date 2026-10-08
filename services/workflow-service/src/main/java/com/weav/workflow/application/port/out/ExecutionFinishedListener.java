package com.weav.workflow.application.port.out;

import java.util.UUID;

/** Told after the transaction that finished an execution (SUCCESS or FAILED) has committed. */
public interface ExecutionFinishedListener {

    /** Must not throw: a listener failure may never change the run result. */
    void onExecutionFinished(UUID executionId);
}
