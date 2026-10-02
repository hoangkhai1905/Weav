package com.weav.identity.infrastructure.persistence;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.infrastructure.persistence.repository.SpringDataUserRepository;
import com.weav.identity.infrastructure.persistence.repository.UserRepositoryAdapter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

@Import(TestcontainersConfiguration.class)
@SpringBootTest(properties = "weav.identity.session-retention-days=30")
class SessionRetentionPurgeJobIntegrationTest {

    @Autowired private SessionRetentionPurgeJob job;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private UserRepositoryAdapter users;
    @Autowired private SpringDataUserRepository springDataUsers;

    private UUID userId;

    @BeforeEach
    void setUp() {
        springDataUsers.deleteAll();
        userId = UUID.randomUUID();
        Instant now = Instant.now();
        users.save(new User(userId, "purge@example.com", "hash", "Purge", null, SystemRole.USER,
                UserStatus.ACTIVE, now, now));
    }

    @Test
    void purgesOnlySessionsRevokedOrExpiredBeyondRetention() {
        insert("old-revoked", days(-60), days(-31));
        insert("old-expired", days(-31), null);
        insert("recent-revoked", days(10), days(-1));
        insert("recent-expired", days(-1), null);
        insert("active", days(10), null);

        assertEquals(2, job.purgeNow());

        List<String> left = jdbc.queryForList(
                "select refresh_token_hash from identity.user_sessions order by refresh_token_hash", String.class);
        assertEquals(List.of("active", "recent-expired", "recent-revoked"), left);
    }

    private void insert(String hash, Instant expiresAt, Instant revokedAt) {
        jdbc.update("insert into identity.user_sessions (id, user_id, refresh_token_hash, expires_at, revoked_at, created_at)"
                        + " values (?, ?, ?, ?, ?, now())",
                UUID.randomUUID(), userId, hash, java.sql.Timestamp.from(expiresAt),
                revokedAt == null ? null : java.sql.Timestamp.from(revokedAt));
    }

    private static Instant days(int offset) {
        return Instant.now().plus(offset, ChronoUnit.DAYS);
    }
}
