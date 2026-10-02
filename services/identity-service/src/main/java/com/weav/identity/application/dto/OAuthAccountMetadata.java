package com.weav.identity.application.dto;

import com.weav.identity.domain.model.OAuthAccount;
import com.weav.identity.domain.valueobject.OAuthProvider;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** Safe self-service metadata for one linked OAuth account. */
public record OAuthAccountMetadata(
        UUID id,
        OAuthProvider provider,
        String providerEmail,
        Instant createdAt,
        Instant updatedAt
) {

    public OAuthAccountMetadata {
        Objects.requireNonNull(id, "id must not be null");
        Objects.requireNonNull(provider, "provider must not be null");
        Objects.requireNonNull(createdAt, "createdAt must not be null");
        Objects.requireNonNull(updatedAt, "updatedAt must not be null");
    }

    public static OAuthAccountMetadata from(OAuthAccount account) {
        Objects.requireNonNull(account, "account must not be null");
        return new OAuthAccountMetadata(
                account.getId(),
                account.getProvider(),
                account.getProviderEmail(),
                account.getCreatedAt(),
                account.getUpdatedAt());
    }
}
