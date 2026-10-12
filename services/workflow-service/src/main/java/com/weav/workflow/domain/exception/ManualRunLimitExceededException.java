package com.weav.workflow.domain.exception;

/** Too many manual runs of one workflow are still queued or in progress. */
public final class ManualRunLimitExceededException extends DomainException {

    public ManualRunLimitExceededException() {
        super("MANUAL_RUN_LIMIT_EXCEEDED",
                "Too many runs of this workflow are still active. Try again when one finishes.");
    }
}
