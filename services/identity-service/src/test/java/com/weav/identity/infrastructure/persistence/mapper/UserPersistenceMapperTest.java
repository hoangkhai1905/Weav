package com.weav.identity.infrastructure.persistence.mapper;

import com.weav.identity.domain.model.User;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.infrastructure.persistence.entity.UserJpaEntity;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

class UserPersistenceMapperTest {

    private final UserPersistenceMapper mapper = new UserPersistenceMapper();

    @Test
    void roundTripsEveryUserStateField() {
        UUID id = UUID.fromString("11111111-1111-1111-1111-111111111111");
        Instant createdAt = Instant.parse("2026-01-01T00:00:00Z");
        Instant updatedAt = Instant.parse("2026-01-02T00:00:00Z");
        User source = new User(id, "user@example.com", null, null, "avatar-key",
                SystemRole.ADMIN, UserStatus.DISABLED, createdAt, updatedAt);

        UserJpaEntity entity = mapper.toEntity(source);
        User restored = mapper.toDomain(entity);

        assertEquals(source.getId(), restored.getId());
        assertEquals(source.getEmail(), restored.getEmail());
        assertEquals(source.getPasswordHash(), restored.getPasswordHash());
        assertEquals(source.getDisplayName(), restored.getDisplayName());
        assertEquals(source.getAvatarStorageKey(), restored.getAvatarStorageKey());
        assertEquals(source.getSystemRole(), restored.getSystemRole());
        assertEquals(source.getStatus(), restored.getStatus());
        assertEquals(source.getCreatedAt(), restored.getCreatedAt());
        assertEquals(source.getUpdatedAt(), restored.getUpdatedAt());
    }
}
