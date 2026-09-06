package com.weav.identity.infrastructure.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserSession;
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

    private UserSession session(String refreshTokenHash) {
        return new UserSession(
                UUID.randomUUID(),
                userId,
                refreshTokenHash,
                "JUnit",
                "127.0.0.1",
                EXPIRES_AT,
                null,
                null,
                CREATED_AT);
    }
}
