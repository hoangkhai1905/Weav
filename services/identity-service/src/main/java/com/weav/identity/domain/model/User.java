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

    public User(UUID id, String email, String passwordHash, String displayName,
                String avatarStorageKey, SystemRole systemRole, UserStatus status,
                Instant createdAt, Instant updatedAt) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.email = Objects.requireNonNull(email, "email must not be null");
        this.systemRole = Objects.requireNonNull(systemRole, "systemRole must not be null");
        this.status = Objects.requireNonNull(status, "status must not be null");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt must not be null");
        this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
        this.passwordHash = passwordHash;
        this.displayName = displayName;
        this.avatarStorageKey = avatarStorageKey;
    }

    public static User createNew(String email, String passwordHash, String displayName, SystemRole systemRole) {
        Instant now = Instant.now();
        return new User(UUID.randomUUID(), email, passwordHash, displayName, null, systemRole, UserStatus.ACTIVE, now, now);
    }

    public void updateDisplayName(String displayName) { this.displayName = displayName; touch(); }
    public void changePassword(String passwordHash) { this.passwordHash = passwordHash; touch(); }
    public void deactivate() { this.status = UserStatus.DISABLED; touch(); }
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
}
