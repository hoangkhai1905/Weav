package com.weav.workspace.infrastructure.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(
        name = "credentials",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_credential_connection",
                columnNames = "connection_id"))
public class CredentialJpaEntity {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "connection_id", nullable = false, updatable = false)
    private UUID connectionId;

    @Column(name = "encrypted_payload", nullable = false, columnDefinition = "bytea")
    private byte[] encryptedPayload;

    @Column(name = "encryption_key_version", length = 64)
    private String encryptionKeyVersion;

    @Column(name = "expires_at")
    private Instant expiresAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected CredentialJpaEntity() {
    }

    public CredentialJpaEntity(
            UUID connectionId,
            byte[] encryptedPayload,
            String encryptionKeyVersion,
            Instant expiresAt) {
        this(
                UUID.randomUUID(),
                connectionId,
                encryptedPayload,
                encryptionKeyVersion,
                expiresAt,
                null,
                null);
    }

    public CredentialJpaEntity(
            UUID id,
            UUID connectionId,
            byte[] encryptedPayload,
            String encryptionKeyVersion,
            Instant expiresAt,
            Instant createdAt,
            Instant updatedAt) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.connectionId = Objects.requireNonNull(connectionId, "connectionId must not be null");
        this.encryptedPayload = Objects.requireNonNull(encryptedPayload, "encryptedPayload must not be null").clone();
        this.encryptionKeyVersion = encryptionKeyVersion;
        this.expiresAt = expiresAt;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    @PrePersist
    void onCreate() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
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

    public UUID getConnectionId() {
        return connectionId;
    }

    public byte[] getEncryptedPayload() {
        return encryptedPayload.clone();
    }

    public void setEncryptedPayload(byte[] encryptedPayload) {
        this.encryptedPayload = Objects.requireNonNull(encryptedPayload, "encryptedPayload must not be null").clone();
    }

    public String getEncryptionKeyVersion() {
        return encryptionKeyVersion;
    }

    public void setEncryptionKeyVersion(String encryptionKeyVersion) {
        this.encryptionKeyVersion = encryptionKeyVersion;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public void setExpiresAt(Instant expiresAt) {
        this.expiresAt = expiresAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
