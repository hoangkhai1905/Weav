package com.weav.identity.domain.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class UserTest {

    private static final Instant CREATED_AT = Instant.parse("2026-01-01T00:00:00Z");
    private static final Instant MUTATED_AT = Instant.parse("2026-01-02T00:00:00Z");

    @Test
    void appliesSuppliedTimestampForProfileAndPasswordMutations() {
        User user = user();

        user.updateDisplayName(null, MUTATED_AT);
        assertNull(user.getDisplayName());
        assertEquals(MUTATED_AT, user.getUpdatedAt());

        Instant passwordChangedAt = MUTATED_AT.plusSeconds(1);
        user.changePassword("replacement-hash", passwordChangedAt);

        assertEquals("replacement-hash", user.getPasswordHash());
        assertEquals(passwordChangedAt, user.getUpdatedAt());
    }

    private static User user() {
        return new User(
                UUID.randomUUID(),
                "user@example.com",
                "original-hash",
                "User",
                null,
                SystemRole.USER,
                UserStatus.ACTIVE,
                CREATED_AT,
                CREATED_AT);
    }
}
