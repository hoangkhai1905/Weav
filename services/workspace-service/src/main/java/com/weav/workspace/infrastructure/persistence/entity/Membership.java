package com.weav.workspace.infrastructure.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(
        name = "memberships",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_membership_workspace_user",
                columnNames = {"workspace_id", "user_id"}))
public class Membership {

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

    protected Membership() {
    }

    public Membership(UUID workspaceId, UUID userId, MembershipRole role) {
        this(workspaceId, userId, role, false, false);
    }

    public Membership(
            UUID workspaceId,
            UUID userId,
            MembershipRole role,
            boolean canPublishWorkflow,
            boolean canManageWorkflowState) {
        this.id = UUID.randomUUID();
        this.workspaceId = workspaceId;
        this.userId = userId;
        this.role = role;
        this.canPublishWorkflow = canPublishWorkflow;
        this.canManageWorkflowState = canManageWorkflowState;
    }

    @PrePersist
    void onCreate() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        Instant now = Instant.now();
        if (joinedAt == null) {
            joinedAt = now;
        }
        if (updatedAt == null) {
            updatedAt = now;
        }
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
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