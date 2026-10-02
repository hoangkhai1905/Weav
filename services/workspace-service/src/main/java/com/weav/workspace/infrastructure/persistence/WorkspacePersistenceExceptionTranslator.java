package com.weav.workspace.infrastructure.persistence;

import com.weav.workspace.domain.exception.WorkspaceNameAlreadyExistsException;
import org.hibernate.exception.ConstraintViolationException;

/** Translates only the known Workspace owner/name constraint. */
public final class WorkspacePersistenceExceptionTranslator {

    public static final String OWNER_NAME_UNIQUE_INDEX = "ux_workspaces_owner_name_normalized";

    private WorkspacePersistenceExceptionTranslator() {
    }

    public static RuntimeException translate(RuntimeException exception) {
        if (hasOwnerNameConstraint(exception)) {
            return new WorkspaceNameAlreadyExistsException();
        }
        return exception;
    }

    private static boolean hasOwnerNameConstraint(Throwable throwable) {
        Throwable current = throwable;
        while (current != null) {
            if (current instanceof ConstraintViolationException violation
                    && OWNER_NAME_UNIQUE_INDEX.equals(violation.getConstraintName())) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }
}
