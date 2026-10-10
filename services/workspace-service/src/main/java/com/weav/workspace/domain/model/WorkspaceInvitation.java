package com.weav.workspace.domain.model;

import com.weav.workspace.domain.exception.InvitationNotPendingException;
import com.weav.workspace.domain.valueobject.InvitationStatus;

import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public class WorkspaceInvitation {
    public static final Duration TTL = Duration.ofDays(7);
    public static final Duration RESEND_COOLDOWN = Duration.ofMinutes(10);
    public static final int MAX_PENDING_PER_WORKSPACE = 50;
    /** Abuse cap: invitations created per workspace in a rolling window, whatever their status. */
    public static final int MAX_CREATED_PER_WINDOW = 20;
    public static final Duration CREATE_WINDOW = Duration.ofHours(24);

    private final UUID id;
    private final UUID workspaceId;
    private final String email;
    private final UUID invitedBy;
    private InvitationStatus status;
    private Instant expiresAt;
    private Instant lastSentAt;
    private Instant respondedAt;
    private UUID respondedBy;
    private final Instant createdAt;
    private Instant updatedAt;

    public WorkspaceInvitation(
            UUID id, UUID workspaceId, String email, UUID invitedBy, InvitationStatus status,
            Instant expiresAt, Instant lastSentAt, Instant respondedAt, UUID respondedBy,
            Instant createdAt, Instant updatedAt) {
        this.id = Objects.requireNonNull(id);
        this.workspaceId = Objects.requireNonNull(workspaceId);
        this.email = Objects.requireNonNull(email);
        this.invitedBy = Objects.requireNonNull(invitedBy);
        this.status = Objects.requireNonNull(status);
        this.expiresAt = Objects.requireNonNull(expiresAt);
        this.lastSentAt = Objects.requireNonNull(lastSentAt);
        this.respondedAt = respondedAt;
        this.respondedBy = respondedBy;
        this.createdAt = Objects.requireNonNull(createdAt);
        this.updatedAt = Objects.requireNonNull(updatedAt);
    }

    public static WorkspaceInvitation pending(UUID workspaceId, String canonicalEmail, UUID invitedBy, Instant now) {
        return new WorkspaceInvitation(UUID.randomUUID(), workspaceId, canonicalEmail, invitedBy,
                InvitationStatus.PENDING, now.plus(TTL), now, null, null, now, now);
    }

    /** PENDING and not yet past its expiry. */
    public boolean isLive(Instant now) {
        return status == InvitationStatus.PENDING && expiresAt.isAfter(now);
    }

    /** Status shown to clients: a PENDING row past its expiry reads EXPIRED. */
    public String viewStatus(Instant now) {
        if (status == InvitationStatus.PENDING && !expiresAt.isAfter(now)) {
            return "EXPIRED";
        }
        return status.name();
    }

    public void revoke(Instant now) {
        respond(InvitationStatus.REVOKED, null, now);
    }

    public void accept(UUID userId, Instant now) {
        respond(InvitationStatus.ACCEPTED, Objects.requireNonNull(userId), now);
    }

    public void decline(UUID userId, Instant now) {
        respond(InvitationStatus.DECLINED, Objects.requireNonNull(userId), now);
    }

    public void resend(Instant now) {
        requirePending();
        this.lastSentAt = now;
        this.expiresAt = now.plus(TTL);
        this.updatedAt = now;
    }

    private void respond(InvitationStatus next, UUID by, Instant now) {
        requirePending();
        this.status = next;
        this.respondedAt = now;
        this.respondedBy = by;
        this.updatedAt = now;
    }

    private void requirePending() {
        if (status != InvitationStatus.PENDING) {
            throw new InvitationNotPendingException();
        }
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
