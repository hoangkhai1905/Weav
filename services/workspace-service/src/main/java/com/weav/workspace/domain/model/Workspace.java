package com.weav.workspace.domain.model;

import java.time.Instant;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;

public class Workspace {
    public static final int MAX_NAME_LENGTH = 255;

    private final UUID id;
    private String name;
    private String nameNormalized;
    private final UUID createdBy;
    private final Instant createdAt;
    private Instant updatedAt;

    public Workspace(UUID id, String name, UUID createdBy, Instant createdAt, Instant updatedAt) {
        this(id, name, normalizeName(name), createdBy, createdAt, updatedAt);
    }

    public Workspace(
            UUID id,
            String name,
            String nameNormalized,
            UUID createdBy,
            Instant createdAt,
            Instant updatedAt) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.name = normalizeDisplayName(name);
        this.nameNormalized = requireNormalizedName(nameNormalized, this.name);
        this.createdBy = Objects.requireNonNull(createdBy, "createdBy must not be null");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt must not be null");
        this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
    }

    public static Workspace createNew(String name, UUID createdBy) {
        Instant now = Instant.now();
        return new Workspace(UUID.randomUUID(), name, createdBy, now, now);
    }

    public void rename(String name) {
        this.name = normalizeDisplayName(name);
        this.nameNormalized = normalizeName(this.name);
        this.updatedAt = Instant.now();
    }

    public static String normalizeDisplayName(String name) {
        String trimmed = Objects.requireNonNull(name, "name must not be null").trim();
        if (trimmed.isEmpty()) {
            throw new IllegalArgumentException("name must not be blank");
        }
        if (trimmed.length() > MAX_NAME_LENGTH) {
            throw new IllegalArgumentException("name must not exceed " + MAX_NAME_LENGTH + " characters");
        }
        return trimmed;
    }

    public static String normalizeName(String name) {
        return normalizeDisplayName(name).toLowerCase(Locale.ROOT);
    }

    private static String requireNormalizedName(String nameNormalized, String displayName) {
        String normalized = Objects.requireNonNull(nameNormalized, "nameNormalized must not be null");
        if (normalized.isBlank() || !normalized.equals(normalized.toLowerCase(Locale.ROOT))) {
            throw new IllegalArgumentException("nameNormalized must be a non-blank lowercase value");
        }
        if (normalized.length() > MAX_NAME_LENGTH) {
            throw new IllegalArgumentException(
                    "nameNormalized must not exceed " + MAX_NAME_LENGTH + " characters");
        }
        if (!normalized.equals(normalizeName(displayName))) {
            throw new IllegalArgumentException("nameNormalized must match the display name");
        }
        return normalized;
    }

    public UUID getId() { return id; }
    public String getName() { return name; }
    public String getNameNormalized() { return nameNormalized; }
    public UUID getCreatedBy() { return createdBy; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
