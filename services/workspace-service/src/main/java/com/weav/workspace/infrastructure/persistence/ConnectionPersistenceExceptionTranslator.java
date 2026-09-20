package com.weav.workspace.infrastructure.persistence;

import com.weav.workspace.domain.exception.ConnectionNameAlreadyExistsException;
import org.hibernate.exception.ConstraintViolationException;

/** Translates only the known Connection workspace/name constraint. */
public final class ConnectionPersistenceExceptionTranslator {

    public static final String CONNECTION_NAME_UNIQUE_INDEX =
            "uk_connections_workspace_name_normalized";

    private ConnectionPersistenceExceptionTranslator() {
    }

    public static RuntimeException translate(RuntimeException exception) {
        ConstraintViolationException violation = findConstraintViolation(exception);
        if (violation != null
                && CONNECTION_NAME_UNIQUE_INDEX.equals(violation.getConstraintName())) {
            return new ConnectionNameAlreadyExistsException();
        }
        return exception;
    }

    private static ConstraintViolationException findConstraintViolation(Throwable throwable) {
        Throwable current = throwable;
        while (current != null) {
            if (current instanceof ConstraintViolationException violation) {
                return violation;
            }
            current = current.getCause();
        }
        return null;
    }
}
