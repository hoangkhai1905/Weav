package com.weav.workspace.domain.model;

import java.time.Instant;
import java.util.Arrays;
import java.util.Objects;
import java.util.UUID;

public class Credential {
    private final UUID id;
    private final UUID connectionId;
    private byte[] encryptedPayload;
    private String encryptionKeyVersion;
    private Instant expiresAt;
    private final Instant createdAt;
    private Instant updatedAt;

    public Credential(UUID id, UUID connectionId, byte[] encryptedPayload, String encryptionKeyVersion,
                      Instant expiresAt, Instant createdAt, Instant updatedAt) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.connectionId = Objects.requireNonNull(connectionId, "connectionId must not be null");
        this.encryptedPayload = Objects.requireNonNull(encryptedPayload, "encryptedPayload must not be null").clone();
        this.encryptionKeyVersion = encryptionKeyVersion;
        this.expiresAt = expiresAt;
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt must not be null");
        this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
    }

    public static Credential createNew(UUID connectionId, byte[] encryptedPayload,
                                       String encryptionKeyVersion, Instant expiresAt) {
        Instant now = Instant.now();
        return new Credential(UUID.randomUUID(), connectionId, encryptedPayload, encryptionKeyVersion, expiresAt, now, now);
    }

    public boolean isExpired(Instant now) { return expiresAt != null && !expiresAt.isAfter(now); }
    public UUID getId() { return id; }
    public UUID getConnectionId() { return connectionId; }
    public byte[] getEncryptedPayload() { return Arrays.copyOf(encryptedPayload, encryptedPayload.length); }
    public String getEncryptionKeyVersion() { return encryptionKeyVersion; }
    public Instant getExpiresAt() { return expiresAt; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
