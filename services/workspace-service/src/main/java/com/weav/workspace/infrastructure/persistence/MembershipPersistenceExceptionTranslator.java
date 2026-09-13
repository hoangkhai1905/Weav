package com.weav.workspace.infrastructure.persistence;

import com.weav.workspace.domain.exception.UserAlreadyMemberException;
import org.hibernate.exception.ConstraintViolationException;

public final class MembershipPersistenceExceptionTranslator {

    private static final String MEMBERSHIP_UNIQUE_CONSTRAINT = "uk_membership_workspace_user";

    private MembershipPersistenceExceptionTranslator() {
    }

    public static RuntimeException translate(RuntimeException exception) {
        ConstraintViolationException violation = findConstraintViolation(exception);
        if (violation != null && MEMBERSHIP_UNIQUE_CONSTRAINT.equals(violation.getConstraintName())) {
            return new UserAlreadyMemberException();
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
