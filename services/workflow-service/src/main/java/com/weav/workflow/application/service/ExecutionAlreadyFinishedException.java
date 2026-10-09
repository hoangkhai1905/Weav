package com.weav.workflow.application.service;

import com.weav.workflow.domain.exception.ConflictException;

/** A stop was requested for a run that has already ended (409 EXECUTION_ALREADY_FINISHED). */
public final class ExecutionAlreadyFinishedException extends ConflictException {

    public ExecutionAlreadyFinishedException() {
        super("EXECUTION_ALREADY_FINISHED", "The execution has already finished");
    }
}
