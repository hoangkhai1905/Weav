package com.weav.identity.domain.exception;

/**
 * A required external dependency is unavailable. The message is deliberately
 * fixed so provider diagnostics never cross the HTTP boundary.
 */
public final class DependencyUnavailableException extends DomainException {

    public DependencyUnavailableException() {
        super("DEPENDENCY_UNAVAILABLE", "A required authentication dependency is temporarily unavailable");
    }
}
