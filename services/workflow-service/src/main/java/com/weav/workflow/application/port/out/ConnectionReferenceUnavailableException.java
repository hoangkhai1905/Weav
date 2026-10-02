package com.weav.workflow.application.port.out;

/** Signals that connection-bearing draft writes cannot be protected until Task 7 is wired. */
public final class ConnectionReferenceUnavailableException extends RuntimeException {

    public ConnectionReferenceUnavailableException() {
        super("Workflow connection reference protection is unavailable");
    }
}
