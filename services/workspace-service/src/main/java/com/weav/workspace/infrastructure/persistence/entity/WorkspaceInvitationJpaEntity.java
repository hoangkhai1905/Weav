package com.weav.workspace.infrastructure.persistence.entity;

import com.weav.workspace.domain.valueobject.InvitationStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "workspace_invitations")
public class WorkspaceInvitationJpaEntity {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "workspace_id", nullable = false, updatable = false)
    private UUID workspaceId;

    @Column(nullable = false, updatable = false, length = 320)
    private String email;

    @Column(name = "invited_by", nullable = false, updatable = false)
    private UUID invitedBy;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private InvitationStatus status;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "last_sent_at", nullable = false)
    private Instant lastSentAt;

    @Column(name = "responded_at")
    private Instant respondedAt;

    @Column(name = "responded_by")
    private UUID respondedBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected WorkspaceInvitationJpaEntity() {
    }

    public WorkspaceInvitationJpaEntity(
            UUID id, UUID workspaceId, String email, UUID invitedBy, InvitationStatus status,
            Instant expiresAt, Instant lastSentAt, Instant respondedAt, UUID respondedBy,
            Instant createdAt, Instant updatedAt) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.email = email;
        this.invitedBy = invitedBy;
        this.status = status;
        this.expiresAt = expiresAt;
        this.lastSentAt = lastSentAt;
        this.respondedAt = respondedAt;
        this.respondedBy = respondedBy;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    public UUID getId() { return id; }
    public UUID getWorkspaceId() { return workspaceId; }
    public String getEmail() { return email; }
    public UUID getInvitedBy() { return invitedBy; }
    public InvitationStatus getStatus() { return status; }
    public Instant getExpiresAt() { return expiresAt; }
    public Instant getLastSentAt() { return lastSentAt; }
    public Instant getRespondedAt() { return respondedAt; }
    public UUID getRespondedBy() { return respondedBy; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
