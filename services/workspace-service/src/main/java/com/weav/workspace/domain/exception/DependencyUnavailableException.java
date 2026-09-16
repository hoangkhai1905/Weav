package com.weav.workspace.domain.exception;

/**
 * A required downstream dependency did not provide a usable response.
 * The message is intentionally stable and contains no downstream payload.
 */
public final class DependencyUnavailableException extends DomainException {

    public DependencyUnavailableException() {
        super("DEPENDENCY_UNAVAILABLE", "A required dependency is temporarily unavailable");
    }
}
