package com.weav.identity.domain.model;

import com.weav.identity.domain.exception.InvalidStateException;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class UserSessionTest {

    @Test
    void reconstitutesAllStateAndKeepsRevokedSessionInactive() {
        UUID id = UUID.fromString("11111111-1111-1111-1111-111111111111");
        UUID userId = UUID.fromString("22222222-2222-2222-2222-222222222222");
        Instant createdAt = Instant.parse("2026-01-01T00:00:00Z");
        Instant lastUsedAt = Instant.parse("2026-01-02T00:00:00Z");
        Instant revokedAt = Instant.parse("2026-01-03T00:00:00Z");
        Instant expiresAt = Instant.parse("2026-01-08T00:00:00Z");

        UserSession session = new UserSession(id, userId, "hash", "agent", "127.0.0.1",
                expiresAt, revokedAt, lastUsedAt, createdAt);

        assertEquals(id, session.getId());
        assertEquals(userId, session.getUserId());
        assertEquals("hash", session.getRefreshTokenHash());
        assertEquals("agent", session.getUserAgent());
        assertEquals("127.0.0.1", session.getIpAddress());
        assertEquals(expiresAt, session.getExpiresAt());
        assertEquals(revokedAt, session.getRevokedAt());
        assertEquals(lastUsedAt, session.getLastUsedAt());
        assertEquals(createdAt, session.getCreatedAt());
        assertFalse(session.isActive(Instant.parse("2026-01-04T00:00:00Z")));
    }

    @Test
    void rotateRefreshTokenPreservesIdentityAndExpiration() {
        Instant createdAt = Instant.parse("2026-01-01T00:00:00Z");
        Instant expiresAt = Instant.parse("2026-01-08T00:00:00Z");
        Instant now = Instant.parse("2026-01-02T00:00:00Z");
        UserSession session = new UserSession(UUID.randomUUID(), UUID.randomUUID(), "old", null, null,
                expiresAt, createdAt);

        UUID id = session.getId();
        session.rotateRefreshToken("new", now);

        assertEquals(id, session.getId());
        assertEquals(expiresAt, session.getExpiresAt());
        assertEquals("new", session.getRefreshTokenHash());
        assertEquals(now, session.getLastUsedAt());
        assertTrue(session.isActive(now));
    }

    @Test
    void rotationRejectsExpiredOrRevokedSession() {
        Instant now = Instant.parse("2026-01-08T00:00:00Z");
        UserSession expired = new UserSession(UUID.randomUUID(), UUID.randomUUID(), "old", null, null,
                now, now.minusSeconds(1));
        UserSession revoked = new UserSession(UUID.randomUUID(), UUID.randomUUID(), "old", null, null,
                now.plusSeconds(1), now.minusSeconds(1), null, now.minusSeconds(2));

        assertThrows(InvalidStateException.class, () -> expired.rotateRefreshToken("new", now));
        assertThrows(InvalidStateException.class, () -> revoked.rotateRefreshToken("new", now));
    }

    @Test
    void revokeAcceptsExplicitTimeForExpiredSession() {
        Instant expiresAt = Instant.parse("2026-01-02T00:00:00Z");
        Instant now = Instant.parse("2026-01-03T00:00:00Z");
        UserSession session = new UserSession(UUID.randomUUID(), UUID.randomUUID(), "hash", null, null,
                expiresAt, expiresAt.minusSeconds(1));

        session.revoke(now);
        session.revoke(now.plusSeconds(1));

        assertEquals(now, session.getRevokedAt());
        assertFalse(session.isActive(now));
    }
}
