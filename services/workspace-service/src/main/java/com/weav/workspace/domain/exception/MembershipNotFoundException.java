package com.weav.workspace.domain.exception;

public final class MembershipNotFoundException extends DomainException {

    public MembershipNotFoundException(Object userId) {
        super("MEMBERSHIP_NOT_FOUND", "Workspace membership was not found: " + userId);
    }
}
