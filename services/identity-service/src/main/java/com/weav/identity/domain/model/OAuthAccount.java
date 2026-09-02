package com.weav.identity.domain.model;

import com.weav.identity.domain.valueobject.OAuthProvider;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public class OAuthAccount {
    private final UUID id;
    private final UUID userId;
    private OAuthProvider provider;
    private String providerUserId;
    private String providerEmail;
    private final Instant createdAt;
    private Instant updatedAt;

    public OAuthAccount(UUID id, UUID userId, OAuthProvider provider, String providerUserId,
                        String providerEmail, Instant createdAt, Instant updatedAt) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.userId = Objects.requireNonNull(userId, "userId must not be null");
        this.provider = Objects.requireNonNull(provider, "provider must not be null");
        this.providerUserId = Objects.requireNonNull(providerUserId, "providerUserId must not be null");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt must not be null");
        this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
        this.providerEmail = providerEmail;
    }

    public static OAuthAccount link(UUID userId, OAuthProvider provider, String providerUserId, String providerEmail) {
        Instant now = Instant.now();
        return new OAuthAccount(UUID.randomUUID(), userId, provider, providerUserId, providerEmail, now, now);
    }

    public void updateEmail(String providerEmail) { this.providerEmail = providerEmail; this.updatedAt = Instant.now(); }
    public UUID getId() { return id; }
    public UUID getUserId() { return userId; }
    public OAuthProvider getProvider() { return provider; }
    public String getProviderUserId() { return providerUserId; }
    public String getProviderEmail() { return providerEmail; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
