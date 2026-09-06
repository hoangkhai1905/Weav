package com.weav.identity.infrastructure.persistence.mapper;

import com.weav.identity.domain.model.UserSession;
import com.weav.identity.infrastructure.persistence.entity.UserSessionJpaEntity;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

class UserSessionPersistenceMapperTest {

    private final UserSessionPersistenceMapper mapper = new UserSessionPersistenceMapper();

    @Test
    void roundTripsEverySessionStateField() {
        UUID id = UUID.fromString("11111111-1111-1111-1111-111111111111");
        UUID userId = UUID.fromString("22222222-2222-2222-2222-222222222222");
        Instant createdAt = Instant.parse("2026-01-01T00:00:00Z");
        Instant lastUsedAt = Instant.parse("2026-01-02T00:00:00Z");
        Instant revokedAt = Instant.parse("2026-01-03T00:00:00Z");
        Instant expiresAt = Instant.parse("2026-01-08T00:00:00Z");
        UserSession source = new UserSession(id, userId, "hash", "agent", "127.0.0.1",
                expiresAt, revokedAt, lastUsedAt, createdAt);

        UserSessionJpaEntity entity = mapper.toEntity(source);
        UserSession restored = mapper.toDomain(entity);

        assertEquals(source.getId(), restored.getId());
        assertEquals(source.getUserId(), restored.getUserId());
        assertEquals(source.getRefreshTokenHash(), restored.getRefreshTokenHash());
        assertEquals(source.getUserAgent(), restored.getUserAgent());
        assertEquals(source.getIpAddress(), restored.getIpAddress());
        assertEquals(source.getExpiresAt(), restored.getExpiresAt());
        assertEquals(source.getRevokedAt(), restored.getRevokedAt());
        assertEquals(source.getLastUsedAt(), restored.getLastUsedAt());
        assertEquals(source.getCreatedAt(), restored.getCreatedAt());
    }

    @Test
    void roundTripsNullHistoricalTimestamps() {
        Instant createdAt = Instant.parse("2026-01-01T00:00:00Z");
        UserSession source = new UserSession(UUID.randomUUID(), UUID.randomUUID(), "hash", null, null,
                Instant.parse("2026-01-08T00:00:00Z"), createdAt);

        UserSession restored = mapper.toDomain(mapper.toEntity(source));

        assertEquals(null, restored.getRevokedAt());
        assertEquals(null, restored.getLastUsedAt());
    }
}
