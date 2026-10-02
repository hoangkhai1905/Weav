package com.weav.workspace.domain.model;

import com.weav.workspace.domain.exception.InvalidStateException;
import com.weav.workspace.domain.valueobject.MembershipRole;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public class Membership {
    private final UUID id;
    private final UUID workspaceId;
    private final UUID userId;
    private final MembershipRole role;
    private boolean canPublishWorkflow;
    private boolean canManageWorkflowState;
    private final Instant joinedAt;
    private Instant updatedAt;

    public Membership(UUID id, UUID workspaceId, UUID userId, MembershipRole role,
                      boolean canPublishWorkflow, boolean canManageWorkflowState,
                      Instant joinedAt, Instant updatedAt) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.workspaceId = Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        this.userId = Objects.requireNonNull(userId, "userId must not be null");
        this.role = Objects.requireNonNull(role, "role must not be null");
        this.joinedAt = Objects.requireNonNull(joinedAt, "joinedAt must not be null");
        this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
        this.canPublishWorkflow = canPublishWorkflow;
        this.canManageWorkflowState = canManageWorkflowState;
    }

    public static Membership createNew(UUID workspaceId, UUID userId, MembershipRole role) {
        Instant now = Instant.now();
        return new Membership(UUID.randomUUID(), workspaceId, userId, role, false, false, now, now);
    }

    public static Membership owner(UUID workspaceId, UUID userId) {
        return createNew(workspaceId, userId, MembershipRole.OWNER);
    }

    public static Membership member(UUID workspaceId, UUID userId) {
        return member(workspaceId, userId, false, false);
    }

    public static Membership member(
            UUID workspaceId,
            UUID userId,
            boolean canPublishWorkflow,
            boolean canManageWorkflowState) {
        Instant now = Instant.now();
        return new Membership(
                UUID.randomUUID(),
                workspaceId,
                userId,
                MembershipRole.MEMBER,
                canPublishWorkflow,
                canManageWorkflowState,
                now,
                now);
    }

    public void updateOptionalPermissions(boolean canPublishWorkflow, boolean canManageWorkflowState) {
        if (role == MembershipRole.OWNER) {
            throw new InvalidStateException("Owner permissions are immutable");
        }
        this.canPublishWorkflow = canPublishWorkflow;
        this.canManageWorkflowState = canManageWorkflowState;
        this.updatedAt = Instant.now();
    }

    public void assertCanLeave() {
        if (role == MembershipRole.OWNER) {
            throw new InvalidStateException("Owner cannot leave the workspace");
        }
    }

    public UUID getId() { return id; }
    public UUID getWorkspaceId() { return workspaceId; }
    public UUID getUserId() { return userId; }
    public MembershipRole getRole() { return role; }
    public boolean isCanPublishWorkflow() { return canPublishWorkflow; }
    public boolean isCanManageWorkflowState() { return canManageWorkflowState; }
    public Instant getJoinedAt() { return joinedAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
