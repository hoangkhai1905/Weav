package com.weav.workflow.application.service;

/** A trigger kind is valid in a draft but its V1 provisioning integration is not ready. */
public final class TriggerDependencyUnavailableException extends RuntimeException {

    public TriggerDependencyUnavailableException() {
        super("Workflow trigger configuration is not available");
    }
}
