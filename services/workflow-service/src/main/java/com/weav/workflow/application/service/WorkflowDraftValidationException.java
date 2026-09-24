package com.weav.workflow.application.service;

import com.weav.workflow.domain.definition.ValidationIssue;

import java.util.List;

/** Safe, value-free validation diagnostics for a rejected draft. */
public final class WorkflowDraftValidationException extends RuntimeException {

    private final List<ValidationIssue> issues;

    public WorkflowDraftValidationException(List<ValidationIssue> issues) {
        super("Workflow definition is invalid");
        this.issues = List.copyOf(issues);
    }

    public List<ValidationIssue> issues() {
        return issues;
    }
}
