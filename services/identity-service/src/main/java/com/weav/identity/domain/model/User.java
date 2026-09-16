package com.weav.identity.domain.model;

import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public class User {
    private final UUID id;
    private String email;
    private String passwordHash;
    private String displayName;
    private String avatarStorageKey;
    private SystemRole systemRole;
    private UserStatus status;
    private final Instant createdAt;
    private Instant updatedAt;
    private Instant emailVerifiedAt;

    public User(UUID id, String email, String passwordHash, String displayName,
                String avatarStorageKey, SystemRole systemRole, UserStatus status,
                Instant createdAt, Instant updatedAt) {
        this(id, email, passwordHash, displayName, avatarStorageKey, systemRole, status,
                createdAt, updatedAt, null);
    }

    public User(UUID id, String email, String passwordHash, String displayName,
                String avatarStorageKey, SystemRole systemRole, UserStatus status,
                Instant createdAt, Instant updatedAt, Instant emailVerifiedAt) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.email = Objects.requireNonNull(email, "email must not be null");
        this.systemRole = Objects.requireNonNull(systemRole, "systemRole must not be null");
        this.status = Objects.requireNonNull(status, "status must not be null");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt must not be null");
        this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
        this.emailVerifiedAt = emailVerifiedAt;
        this.passwordHash = passwordHash;
        this.displayName = displayName;
        this.avatarStorageKey = avatarStorageKey;
    }

    public static User createNew(String email, String passwordHash, String displayName, SystemRole systemRole) {
        Instant now = Instant.now();
        return new User(UUID.randomUUID(), email, passwordHash, displayName, null, systemRole, UserStatus.ACTIVE, now, now);
    }

    public void updateDisplayName(String displayName, Instant updatedAt) {
        this.displayName = displayName;
        touch(updatedAt);
    }

    public void changePassword(String passwordHash, Instant updatedAt) {
        this.passwordHash = Objects.requireNonNull(passwordHash, "passwordHash must not be null");
        touch(updatedAt);
    }

    public void markEmailVerified(Instant verifiedAt) {
        if (emailVerifiedAt == null) {
            emailVerifiedAt = Objects.requireNonNull(verifiedAt, "verifiedAt must not be null");
            touch(verifiedAt);
        }
    }

    public void deactivate() { changeStatus(UserStatus.DISABLED, Instant.now()); }

    public void changeStatus(UserStatus status, Instant updatedAt) {
        this.status = Objects.requireNonNull(status, "status must not be null");
        touch(updatedAt);
    }

    public void replaceAvatarStorageKey(String avatarStorageKey, Instant updatedAt) {
        if (avatarStorageKey == null || avatarStorageKey.isBlank()) {
            throw new IllegalArgumentException("avatarStorageKey must not be blank");
        }
        this.avatarStorageKey = avatarStorageKey;
        touch(updatedAt);
    }

    public void clearAvatarStorageKey(Instant updatedAt) {
        this.avatarStorageKey = null;
        touch(updatedAt);
    }

    private void touch(Instant updatedAt) {
        this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
    }

    private void touch() { this.updatedAt = Instant.now(); }

    public UUID getId() { return id; }
    public String getEmail() { return email; }
    public String getPasswordHash() { return passwordHash; }
    public String getDisplayName() { return displayName; }
    public String getAvatarStorageKey() { return avatarStorageKey; }
    public SystemRole getSystemRole() { return systemRole; }
    public UserStatus getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public Instant getEmailVerifiedAt() { return emailVerifiedAt; }
}
