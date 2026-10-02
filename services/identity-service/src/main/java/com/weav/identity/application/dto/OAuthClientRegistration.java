package com.weav.identity.application.dto;

import com.weav.identity.domain.valueobject.OAuthProvider;

import java.net.URI;
import java.util.Objects;
import java.util.Set;

/**
 * Immutable, server-selected registration for one logical OAuth client.
 * Request data may select only the logical identifiers; it may not supply any
 * of the URI values held here.
 */
public record OAuthClientRegistration(
        String clientId,
        String returnTargetId,
        OAuthProvider provider,
        String providerClientId,
        URI providerCallbackUri,
        URI returnTargetUri,
        Set<String> allowedOrigins
) {

    public OAuthClientRegistration {
        requireLogicalId(clientId, "clientId");
        requireLogicalId(returnTargetId, "returnTargetId");
        Objects.requireNonNull(provider, "provider must not be null");
        requireBoundedAscii(providerClientId, "providerClientId", 1, 256);
        Objects.requireNonNull(providerCallbackUri, "providerCallbackUri must not be null");
        Objects.requireNonNull(returnTargetUri, "returnTargetUri must not be null");
        if (allowedOrigins == null || allowedOrigins.isEmpty()) {
            throw new IllegalArgumentException("allowedOrigins must not be empty");
        }
        allowedOrigins = Set.copyOf(allowedOrigins);
    }

    public boolean allowsOrigin(String origin) {
        return origin != null && allowedOrigins.contains(origin);
    }

    private static void requireLogicalId(String value, String name) {
        requireBoundedAscii(value, name, 1, 32);
        if (value.chars().anyMatch(Character::isWhitespace)) {
            throw new IllegalArgumentException(name + " must not contain whitespace");
        }
    }

    private static void requireBoundedAscii(String value, String name, int min, int max) {
        if (value == null || value.length() < min || value.length() > max
                || value.chars().anyMatch(character -> character < 0x20 || character > 0x7e)) {
            throw new IllegalArgumentException(name + " must be printable ASCII of length " + min + ".." + max);
        }
    }
}
