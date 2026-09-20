package com.weav.workspace.infrastructure.persistence.entity;

import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.valueobject.ConnectionStatus;

import tools.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "connections")
public class ConnectionJpaEntity {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "workspace_id", nullable = false, updatable = false)
    private UUID workspaceId;

    @Column(name = "created_by", nullable = false, updatable = false)
    private UUID createdBy;

    @Column(nullable = false, length = 255)
    private String name;

    @Column(name = "name_normalized", nullable = false, length = 255)
    private String nameNormalized;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private ConnectionProvider provider;

    @Enumerated(EnumType.STRING)
    @Column(name = "auth_type", nullable = false, length = 32)
    private ConnectionAuthType authType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private ConnectionStatus status;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private JsonNode config;

    @Column(name = "last_verified_at")
    private Instant lastVerifiedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected ConnectionJpaEntity() {
    }

    public ConnectionJpaEntity(
            UUID workspaceId,
            UUID createdBy,
            String name,
            ConnectionProvider provider,
            ConnectionAuthType authType,
            ConnectionStatus status,
            JsonNode config) {
        this(
                UUID.randomUUID(),
                workspaceId,
                createdBy,
                name,
                Connection.normalizeName(name),
                provider,
                authType,
                status,
                config,
                null,
                null,
                null);
    }

    public ConnectionJpaEntity(
            UUID id,
            UUID workspaceId,
            UUID createdBy,
            String name,
            String nameNormalized,
            ConnectionProvider provider,
            ConnectionAuthType authType,
            ConnectionStatus status,
            JsonNode config,
            Instant lastVerifiedAt,
            Instant createdAt,
            Instant updatedAt) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.workspaceId = Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        this.createdBy = Objects.requireNonNull(createdBy, "createdBy must not be null");
        this.name = Objects.requireNonNull(name, "name must not be null");
        this.nameNormalized = Objects.requireNonNull(nameNormalized, "nameNormalized must not be null");
        this.provider = Objects.requireNonNull(provider, "provider must not be null");
        this.authType = Objects.requireNonNull(authType, "authType must not be null");
        this.status = Objects.requireNonNull(status, "status must not be null");
        this.config = config;
        this.lastVerifiedAt = lastVerifiedAt;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    @PrePersist
    void onCreate() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (nameNormalized == null && name != null) {
            nameNormalized = Connection.normalizeName(name);
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

    public UUID getWorkspaceId() {
        return workspaceId;
    }

    public UUID getCreatedBy() {
        return createdBy;
    }

    public String getName() {
        return name;
    }

    public String getNameNormalized() {
        return nameNormalized;
    }

    public void setName(String name) {
        this.name = name;
        this.nameNormalized = Connection.normalizeName(name);
    }

    public ConnectionProvider getProvider() {
        return provider;
    }

    public void setProvider(ConnectionProvider provider) {
        this.provider = provider;
    }

    public ConnectionAuthType getAuthType() {
        return authType;
    }

    public void setAuthType(ConnectionAuthType authType) {
        this.authType = authType;
    }

    public ConnectionStatus getStatus() {
        return status;
    }

    public void setStatus(ConnectionStatus status) {
        this.status = status;
    }

    public JsonNode getConfig() {
        return config;
    }

    public void setConfig(JsonNode config) {
        this.config = config;
    }

    public Instant getLastVerifiedAt() {
        return lastVerifiedAt;
    }

    public void setLastVerifiedAt(Instant lastVerifiedAt) {
        this.lastVerifiedAt = lastVerifiedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
