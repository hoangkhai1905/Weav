package com.weav.workflow.application.service;

import com.weav.workflow.domain.exception.ConflictException;

/** Signals that the draft changed after its publish snapshot was validated. */
public final class DraftChangedException extends ConflictException {

    public DraftChangedException() {
        super("Workflow draft changed while publishing");
    }
}
