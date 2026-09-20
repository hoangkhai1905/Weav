package com.weav.workspace.application.dto;

import java.util.Objects;

/**
 * Secret-free result of a provider verification attempt.
 */
public record ConnectionTestResult(ConnectionTestOutcome outcome) {

    public ConnectionTestResult {
        Objects.requireNonNull(outcome, "outcome must not be null");
    }

    public static ConnectionTestResult verified() {
        return new ConnectionTestResult(ConnectionTestOutcome.VERIFIED);
    }

    public static ConnectionTestResult authInvalid() {
        return new ConnectionTestResult(ConnectionTestOutcome.AUTH_INVALID);
    }

    public static ConnectionTestResult dependencyFailure() {
        return new ConnectionTestResult(ConnectionTestOutcome.DEPENDENCY_FAILURE);
    }

    public enum ConnectionTestOutcome {
        VERIFIED,
        AUTH_INVALID,
        DEPENDENCY_FAILURE
    }
}
