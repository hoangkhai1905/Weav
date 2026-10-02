package com.weav.identity.infrastructure.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.model.UserSessionPage;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.infrastructure.persistence.repository.SpringDataUserRepository;
import com.weav.identity.infrastructure.persistence.repository.SpringDataUserSessionRepository;
import com.weav.identity.infrastructure.persistence.repository.UserRepositoryAdapter;
import com.weav.identity.infrastructure.persistence.repository.UserSessionRepositoryAdapter;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.InvalidDataAccessApiUsageException;
import org.springframework.transaction.support.TransactionTemplate;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class UserSessionPersistenceIntegrationTest {

    private static final Instant CREATED_AT = Instant.parse("2026-01-02T03:04:05Z");
    private static final Instant EXPIRES_AT = Instant.parse("2027-01-02T03:04:05Z");

    @Autowired
    private UserRepositoryAdapter userRepository;

    @Autowired
    private UserSessionRepositoryAdapter userSessionRepository;

    @Autowired
    private SpringDataUserRepository springDataUserRepository;

    @Autowired
    private SpringDataUserSessionRepository springDataUserSessionRepository;

    @Autowired
    private TransactionTemplate transactionTemplate;

    private UUID userId;

    @BeforeEach
    void cleanDatabaseAndCreateUser() {
        springDataUserSessionRepository.deleteAll();
        springDataUserRepository.deleteAll();
        userId = userRepository.save(new User(
                UUID.randomUUID(),
                "session-owner@example.com",
                "$2a$10$test-password-hash",
                "Session Owner",
                null,
                SystemRole.USER,
                UserStatus.ACTIVE,
                CREATED_AT,
                CREATED_AT)).getId();
    }

    @Test
    void savesAndReloadsSessionWithNullableState() {
        UserSession session = new UserSession(
                UUID.randomUUID(),
                userId,
                "initial-refresh-hash",
                null,
                null,
                EXPIRES_AT,
                null,
                null,
                CREATED_AT);

        userSessionRepository.save(session);
        UserSession reloaded = userSessionRepository.findById(session.getId()).orElseThrow();

        assertEquals(session.getId(), reloaded.getId());
        assertEquals(userId, reloaded.getUserId());
        assertEquals("initial-refresh-hash", reloaded.getRefreshTokenHash());
        assertNull(reloaded.getUserAgent());
        assertNull(reloaded.getIpAddress());
        assertNull(reloaded.getRevokedAt());
        assertNull(reloaded.getLastUsedAt());
        assertEquals(EXPIRES_AT, reloaded.getExpiresAt());
        assertEquals(CREATED_AT, reloaded.getCreatedAt());
    }

    @Test
    void persistsRefreshTokenRotationAndRevocation() {
        UserSession session = session("old-refresh-hash");
        userSessionRepository.save(session);

        Instant rotatedAt = Instant.parse("2026-02-03T04:05:06Z");
        session.rotateRefreshToken("new-refresh-hash", rotatedAt);
        userSessionRepository.save(session);

        Instant revokedAt = Instant.parse("2026-02-04T05:06:07Z");
        session.revoke(revokedAt);
        userSessionRepository.save(session);

        UserSession reloaded = userSessionRepository.findById(session.getId()).orElseThrow();
        assertEquals("new-refresh-hash", reloaded.getRefreshTokenHash());
        assertEquals(rotatedAt, reloaded.getLastUsedAt());
        assertEquals(revokedAt, reloaded.getRevokedAt());
        assertFalse(userSessionRepository.findByRefreshTokenHash("old-refresh-hash").isPresent());
        assertEquals(session.getId(),
                userSessionRepository.findByRefreshTokenHash("new-refresh-hash").orElseThrow().getId());
    }

    @Test
    void lockedRefreshHashLookupRequiresAndWorksInsideTransaction() {
        UserSession session = session("locked-refresh-hash");
        userSessionRepository.save(session);

        assertThrows(InvalidDataAccessApiUsageException.class,
                () -> userSessionRepository.findByRefreshTokenHashForUpdate("locked-refresh-hash"));

        UserSession locked = transactionTemplate.execute(status -> {
            assertTrue(status.isNewTransaction());
            return userSessionRepository.findByRefreshTokenHashForUpdate("locked-refresh-hash").orElseThrow();
        });

        assertEquals(session.getId(), locked.getId());
    }

    @Test
    void listsOnlyActiveSessionsInStableOrderAndRevokesAllUnrevokedSessions() {
        Instant now = CREATED_AT.plusSeconds(100);
        UUID firstId = UUID.fromString("00000000-0000-0000-0000-000000000001");
        UUID secondId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        UUID expiredId = UUID.fromString("00000000-0000-0000-0000-000000000003");
        UUID otherUserId = userRepository.save(new User(
                UUID.randomUUID(),
                "other-session-owner@example.com",
                "$2a$10$test-password-hash",
                "Other Session Owner",
                null,
                SystemRole.USER,
                UserStatus.ACTIVE,
                CREATED_AT,
                CREATED_AT)).getId();
        userSessionRepository.save(session(firstId, userId, "active-first", now.plusSeconds(100), now));
        userSessionRepository.save(session(secondId, userId, "active-second", now.plusSeconds(100), now));
        userSessionRepository.save(session(expiredId, userId, "expired", now, now.plusSeconds(1)));
        userSessionRepository.save(session(UUID.randomUUID(), otherUserId, "other-user", now.plusSeconds(100), now));

        UserSessionPage page = userSessionRepository.findActiveByUserId(userId, now, 0, 20);

        assertEquals(2, page.totalItems());
        assertEquals(1, page.totalPages());
        assertEquals(2, page.items().size());
        assertEquals(firstId, page.items().get(0).getId());
        assertEquals(secondId, page.items().get(1).getId());

        Instant revokedAt = now.plusSeconds(10);
        int revoked = transactionTemplate.execute(status -> userSessionRepository.revokeAllForUser(userId, revokedAt));

        assertEquals(3, revoked);
        assertEquals(revokedAt, userSessionRepository.findById(firstId).orElseThrow().getRevokedAt());
        assertEquals(revokedAt, userSessionRepository.findById(secondId).orElseThrow().getRevokedAt());
        assertEquals(revokedAt, userSessionRepository.findById(expiredId).orElseThrow().getRevokedAt());
        assertNull(userSessionRepository.findByRefreshTokenHash("other-user").orElseThrow().getRevokedAt());
    }

    @Test
    void exactLockedLookupRequiresAndWorksInsideTransaction() {
        UserSession session = session("locked-id-hash");
        userSessionRepository.save(session);

        assertThrows(InvalidDataAccessApiUsageException.class,
                () -> userSessionRepository.findByIdForUpdate(session.getId()));

        UserSession locked = transactionTemplate.execute(status ->
                userSessionRepository.findByIdForUpdate(session.getId()).orElseThrow());

        assertEquals(session.getId(), locked.getId());
    }

    private UserSession session(String refreshTokenHash) {
        return session(UUID.randomUUID(), userId, refreshTokenHash, EXPIRES_AT, CREATED_AT);
    }

    private UserSession session(
            UUID id,
            UUID ownerId,
            String refreshTokenHash,
            Instant expiresAt,
            Instant createdAt) {
        return new UserSession(
                id,
                ownerId,
                refreshTokenHash,
                "JUnit",
                "127.0.0.1",
                expiresAt,
                null,
                null,
                createdAt);
    }
}
