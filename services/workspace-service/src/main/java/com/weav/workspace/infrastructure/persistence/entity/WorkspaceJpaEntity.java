package com.weav.workspace.infrastructure.persistence.entity;

import com.weav.workspace.domain.model.Workspace;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "workspaces")
public class WorkspaceJpaEntity {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(nullable = false, length = 255)
    private String name;

    @Column(name = "name_normalized", nullable = false, length = 255)
    private String nameNormalized;

    @Column(name = "created_by", nullable = false, updatable = false)
    private UUID createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected WorkspaceJpaEntity() {
    }

    public WorkspaceJpaEntity(String name, UUID createdBy) {
        this.id = UUID.randomUUID();
        this.name = Workspace.normalizeDisplayName(name);
        this.nameNormalized = Workspace.normalizeName(name);
        this.createdBy = Objects.requireNonNull(createdBy, "createdBy must not be null");
        Instant now = Instant.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    public WorkspaceJpaEntity(
            UUID id,
            String name,
            String nameNormalized,
            UUID createdBy,
            Instant createdAt,
            Instant updatedAt) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.name = Workspace.normalizeDisplayName(name);
        this.nameNormalized = Objects.requireNonNull(nameNormalized, "nameNormalized must not be null");
        this.createdBy = Objects.requireNonNull(createdBy, "createdBy must not be null");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt must not be null");
        this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
    }

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getNameNormalized() {
        return nameNormalized;
    }

    public void setName(String name) {
        this.name = name;
    }

    public void setNameNormalized(String nameNormalized) {
        this.nameNormalized = nameNormalized;
    }

    public UUID getCreatedBy() {
        return createdBy;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
