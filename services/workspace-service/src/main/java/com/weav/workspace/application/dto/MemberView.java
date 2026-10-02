package com.weav.workspace.application.dto;

import com.weav.workspace.domain.model.IdentityUserSummary;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.valueobject.MembershipRole;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public record MemberView(
        UUID userId,
        MembershipRole role,
        boolean canPublishWorkflow,
        boolean canManageWorkflowState,
        Instant joinedAt,
        Instant updatedAt,
        String email,
        String displayName,
        boolean active) {

    public MemberView {
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(role, "role must not be null");
        Objects.requireNonNull(joinedAt, "joinedAt must not be null");
        Objects.requireNonNull(updatedAt, "updatedAt must not be null");
        Objects.requireNonNull(email, "email must not be null");
    }

    public static MemberView from(Membership membership, IdentityUserSummary summary) {
        Objects.requireNonNull(membership, "membership must not be null");
        Objects.requireNonNull(summary, "summary must not be null");
        if (!membership.getUserId().equals(summary.userId())) {
            throw new IllegalArgumentException("membership and Identity user IDs must match");
        }
        return new MemberView(
                membership.getUserId(),
                membership.getRole(),
                membership.isCanPublishWorkflow(),
                membership.isCanManageWorkflowState(),
                membership.getJoinedAt(),
                membership.getUpdatedAt(),
                summary.email(),
                summary.displayName(),
                summary.active());
    }
}
