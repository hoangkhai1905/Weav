package com.weav.workflow.application.port.in;

import com.weav.workflow.application.port.out.ExecutionStatePort;

/** Application handoff for a claimed execution. A concrete runner is supplied by Task 11. */
@FunctionalInterface
public interface ExecutionRunner {
    void run(ExecutionStatePort.Lease lease);
}
