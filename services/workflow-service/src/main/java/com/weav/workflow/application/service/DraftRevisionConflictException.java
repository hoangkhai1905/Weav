package com.weav.workflow.application.service;

import com.weav.workflow.domain.exception.ConflictException;

/** Signals that a draft save was based on a revision that is no longer current (WF-8). */
public final class DraftRevisionConflictException extends ConflictException {

    private final long currentRevision;

    public DraftRevisionConflictException(long currentRevision) {
        super("Workflow draft was changed by another save");
        this.currentRevision = currentRevision;
    }

    public long currentRevision() {
        return currentRevision;
    }
}
