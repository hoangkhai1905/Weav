package com.weav.workspace.application.dto;

import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.valueobject.ConnectionStatus;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Secret-safe view of a workspace connection.
 *
 * <p>The response deliberately contains credential metadata only. Encrypted
 * payloads, key versions, credential identifiers, and plaintext auth values
 * are application-internal and never belong in this DTO.</p>
 */
public record ConnectionResponse(
        UUID id,
        UUID workspaceId,
        UUID createdBy,
        String name,
        ConnectionProvider provider,
        ConnectionAuthType authType,
        ConnectionStatus status,
        Map<String, Object> config,
        boolean hasCredential,
        Instant credentialExpiresAt,
        Instant lastVerifiedAt,
        boolean canManage,
        boolean canAttach,
        Instant createdAt,
        Instant updatedAt) {

    public ConnectionResponse {
        Objects.requireNonNull(id, "id must not be null");
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(createdBy, "createdBy must not be null");
        Objects.requireNonNull(name, "name must not be null");
        Objects.requireNonNull(provider, "provider must not be null");
        Objects.requireNonNull(authType, "authType must not be null");
        Objects.requireNonNull(status, "status must not be null");
        Objects.requireNonNull(createdAt, "createdAt must not be null");
        Objects.requireNonNull(updatedAt, "updatedAt must not be null");
        config = config == null ? null : Map.copyOf(config);
    }
}
