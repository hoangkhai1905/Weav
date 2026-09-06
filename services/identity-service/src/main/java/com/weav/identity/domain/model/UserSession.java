package com.weav.identity.domain.model;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

import com.weav.identity.domain.exception.InvalidStateException;

public class UserSession {
    private final UUID id;
    private final UUID userId;
    private String refreshTokenHash;
    private String userAgent;
    private String ipAddress;
    private Instant expiresAt;
    private Instant revokedAt;
    private Instant lastUsedAt;
    private final Instant createdAt;

    public UserSession(UUID id, UUID userId, String refreshTokenHash, String userAgent,
                       String ipAddress, Instant expiresAt, Instant createdAt) {
        this(id, userId, refreshTokenHash, userAgent, ipAddress, expiresAt, null, null, createdAt);
    }

    public UserSession(UUID id, UUID userId, String refreshTokenHash, String userAgent,
                       String ipAddress, Instant expiresAt, Instant revokedAt,
                       Instant lastUsedAt, Instant createdAt) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.userId = Objects.requireNonNull(userId, "userId must not be null");
        this.refreshTokenHash = Objects.requireNonNull(refreshTokenHash, "refreshTokenHash must not be null");
        this.expiresAt = Objects.requireNonNull(expiresAt, "expiresAt must not be null");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt must not be null");
        this.userAgent = userAgent;
        this.ipAddress = ipAddress;
        this.revokedAt = revokedAt;
        this.lastUsedAt = lastUsedAt;
    }

    public static UserSession createNew(UUID userId, String refreshTokenHash, String userAgent,
                                        String ipAddress, Instant expiresAt) {
        return new UserSession(UUID.randomUUID(), userId, refreshTokenHash, userAgent,
                ipAddress, expiresAt, Instant.now());
    }

    public void revoke() { revoke(Instant.now()); }

    public void revoke(Instant now) {
        Objects.requireNonNull(now, "now must not be null");
        if (this.revokedAt == null) {
            this.revokedAt = now;
        }
    }

    public void markUsed() { markUsed(Instant.now()); }

    public void markUsed(Instant now) {
        this.lastUsedAt = Objects.requireNonNull(now, "now must not be null");
    }

    public void rotateRefreshToken(String newHash, Instant now) {
        Objects.requireNonNull(newHash, "newHash must not be null");
        Objects.requireNonNull(now, "now must not be null");
        if (!isActive(now)) {
            throw new InvalidStateException("session is not active");
        }
        this.refreshTokenHash = newHash;
        this.lastUsedAt = now;
    }

    public boolean isActive(Instant now) { return revokedAt == null && expiresAt.isAfter(now); }

    public UUID getId() { return id; }
    public UUID getUserId() { return userId; }
    public String getRefreshTokenHash() { return refreshTokenHash; }
    public String getUserAgent() { return userAgent; }
    public String getIpAddress() { return ipAddress; }
    public Instant getExpiresAt() { return expiresAt; }
    public Instant getRevokedAt() { return revokedAt; }
    public Instant getLastUsedAt() { return lastUsedAt; }
    public Instant getCreatedAt() { return createdAt; }
}
