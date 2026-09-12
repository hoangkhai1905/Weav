package com.weav.workspace.infrastructure.persistence.entity;

import com.weav.workspace.domain.valueobject.MembershipRole;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(
        name = "memberships",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_membership_workspace_user",
                columnNames = {"workspace_id", "user_id"}))
public class MembershipJpaEntity {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "workspace_id", nullable = false, updatable = false)
    private UUID workspaceId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private MembershipRole role;

    @Column(name = "can_publish_workflow", nullable = false)
    private boolean canPublishWorkflow;

    @Column(name = "can_manage_workflow_state", nullable = false)
    private boolean canManageWorkflowState;

    @Column(name = "joined_at", nullable = false, updatable = false)
    private Instant joinedAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected MembershipJpaEntity() {
    }

    public MembershipJpaEntity(UUID workspaceId, UUID userId, MembershipRole role) {
        this(workspaceId, userId, role, false, false);
    }

    public MembershipJpaEntity(
            UUID workspaceId,
            UUID userId,
            MembershipRole role,
            boolean canPublishWorkflow,
            boolean canManageWorkflowState) {
        this.id = UUID.randomUUID();
        this.workspaceId = Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        this.userId = Objects.requireNonNull(userId, "userId must not be null");
        this.role = Objects.requireNonNull(role, "role must not be null");
        this.canPublishWorkflow = canPublishWorkflow;
        this.canManageWorkflowState = canManageWorkflowState;
        Instant now = Instant.now();
        this.joinedAt = now;
        this.updatedAt = now;
    }

    public MembershipJpaEntity(
            UUID id,
            UUID workspaceId,
            UUID userId,
            MembershipRole role,
            boolean canPublishWorkflow,
            boolean canManageWorkflowState,
            Instant joinedAt,
            Instant updatedAt) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.workspaceId = Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        this.userId = Objects.requireNonNull(userId, "userId must not be null");
        this.role = Objects.requireNonNull(role, "role must not be null");
        this.canPublishWorkflow = canPublishWorkflow;
        this.canManageWorkflowState = canManageWorkflowState;
        this.joinedAt = Objects.requireNonNull(joinedAt, "joinedAt must not be null");
        this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
    }

    public UUID getId() {
        return id;
    }

    public UUID getWorkspaceId() {
        return workspaceId;
    }

    public UUID getUserId() {
        return userId;
    }

    public MembershipRole getRole() {
        return role;
    }

    public void setRole(MembershipRole role) {
        this.role = role;
    }

    public boolean isCanPublishWorkflow() {
        return canPublishWorkflow;
    }

    public void setCanPublishWorkflow(boolean canPublishWorkflow) {
        this.canPublishWorkflow = canPublishWorkflow;
    }

    public boolean isCanManageWorkflowState() {
        return canManageWorkflowState;
    }

    public void setCanManageWorkflowState(boolean canManageWorkflowState) {
        this.canManageWorkflowState = canManageWorkflowState;
    }

    public Instant getJoinedAt() {
        return joinedAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
