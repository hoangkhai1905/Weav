package com.weav.workspace.domain.model;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public class Workspace {
    private final UUID id;
    private String name;
    private final UUID createdBy;
    private final Instant createdAt;
    private Instant updatedAt;

    public Workspace(UUID id, String name, UUID createdBy, Instant createdAt, Instant updatedAt) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.name = requireName(name);
        this.createdBy = Objects.requireNonNull(createdBy, "createdBy must not be null");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt must not be null");
        this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
    }

    public static Workspace createNew(String name, UUID createdBy) {
        Instant now = Instant.now();
        return new Workspace(UUID.randomUUID(), name, createdBy, now, now);
    }

    public void rename(String name) { this.name = requireName(name); this.updatedAt = Instant.now(); }
    private static String requireName(String name) { return Objects.requireNonNull(name, "name must not be null"); }

    public UUID getId() { return id; }
    public String getName() { return name; }
    public UUID getCreatedBy() { return createdBy; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
