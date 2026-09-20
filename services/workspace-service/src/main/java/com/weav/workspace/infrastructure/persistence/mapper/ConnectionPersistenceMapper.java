package com.weav.workspace.infrastructure.persistence.mapper;

import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.infrastructure.persistence.entity.ConnectionJpaEntity;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;
import java.util.Objects;

public class ConnectionPersistenceMapper {

    private static final TypeReference<Map<String, Object>> CONFIG_TYPE =
            new TypeReference<>() {
            };

    private final ObjectMapper objectMapper;

    public ConnectionPersistenceMapper() {
        this(new ObjectMapper());
    }

    public ConnectionPersistenceMapper(ObjectMapper objectMapper) {
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
    }

    public ConnectionJpaEntity toEntity(Connection connection) {
        Objects.requireNonNull(connection, "connection must not be null");
        JsonNode config = objectMapper.valueToTree(connection.getConfig());
        return new ConnectionJpaEntity(
                connection.getId(),
                connection.getWorkspaceId(),
                connection.getCreatedBy(),
                connection.getName(),
                Connection.normalizeName(connection.getName()),
                connection.getProvider(),
                connection.getAuthType(),
                connection.getStatus(),
                config,
                connection.getLastVerifiedAt(),
                connection.getCreatedAt(),
                connection.getUpdatedAt());
    }

    public Connection toDomain(ConnectionJpaEntity entity) {
        Objects.requireNonNull(entity, "entity must not be null");
        Map<String, Object> config = entity.getConfig() == null || entity.getConfig().isNull()
                ? Map.of()
                : objectMapper.convertValue(entity.getConfig(), CONFIG_TYPE);
        return new Connection(
                entity.getId(),
                entity.getWorkspaceId(),
                entity.getCreatedBy(),
                entity.getName(),
                entity.getProvider(),
                entity.getAuthType(),
                entity.getStatus(),
                config,
                entity.getLastVerifiedAt(),
                entity.getCreatedAt(),
                entity.getUpdatedAt());
    }
}
