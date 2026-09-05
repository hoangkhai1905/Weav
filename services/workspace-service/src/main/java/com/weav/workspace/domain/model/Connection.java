package com.weav.workspace.domain.model;

import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public class Connection {
    private final UUID id;
    private final UUID workspaceId;
    private final UUID createdBy;
    private String name;
    private final ConnectionProvider provider;
    private final ConnectionAuthType authType;
    private ConnectionStatus status;
    private Map<String, Object> config;
    private Instant lastVerifiedAt;
    private final Instant createdAt;
    private Instant updatedAt;

    public Connection(UUID id, UUID workspaceId, UUID createdBy, String name,
                      ConnectionProvider provider, ConnectionAuthType authType,
                      ConnectionStatus status, Map<String, Object> config,
                      Instant lastVerifiedAt, Instant createdAt, Instant updatedAt) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.workspaceId = Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        this.createdBy = Objects.requireNonNull(createdBy, "createdBy must not be null");
        this.name = Objects.requireNonNull(name, "name must not be null");
        this.provider = Objects.requireNonNull(provider, "provider must not be null");
        this.authType = Objects.requireNonNull(authType, "authType must not be null");
        this.status = Objects.requireNonNull(status, "status must not be null");
        this.config = config == null ? Map.of() : Map.copyOf(config);
        this.lastVerifiedAt = lastVerifiedAt;
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt must not be null");
        this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
    }

    public static Connection createNew(UUID workspaceId, UUID createdBy, String name,
                                       ConnectionProvider provider, ConnectionAuthType authType,
                                       Map<String, Object> config) {
        Instant now = Instant.now();
        return new Connection(UUID.randomUUID(), workspaceId, createdBy, name, provider, authType,
                ConnectionStatus.ACTIVE, config, null, now, now);
    }

    public void markInvalid() { status = ConnectionStatus.INVALID; updatedAt = Instant.now(); }
    public void markVerified(Instant verifiedAt) { status = ConnectionStatus.ACTIVE; lastVerifiedAt = verifiedAt; updatedAt = Instant.now(); }

    public UUID getId() { return id; }
    public UUID getWorkspaceId() { return workspaceId; }
    public UUID getCreatedBy() { return createdBy; }
    public String getName() { return name; }
    public ConnectionProvider getProvider() { return provider; }
    public ConnectionAuthType getAuthType() { return authType; }
    public ConnectionStatus getStatus() { return status; }
    public Map<String, Object> getConfig() { return config; }
    public Instant getLastVerifiedAt() { return lastVerifiedAt; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
