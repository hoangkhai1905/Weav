package com.weav.identity.infrastructure.persistence;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.domain.exception.ConflictException;
import com.weav.identity.domain.model.OAuthAccount;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.valueobject.OAuthProvider;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.infrastructure.persistence.repository.OAuthAccountRepositoryAdapter;
import com.weav.identity.infrastructure.persistence.repository.SpringDataOAuthAccountRepository;
import com.weav.identity.infrastructure.persistence.repository.SpringDataUserRepository;
import com.weav.identity.infrastructure.persistence.repository.UserRepositoryAdapter;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class OAuthAccountPersistenceIntegrationTest {

    private static final Instant CREATED_AT = Instant.parse("2026-01-02T03:04:05Z");
    private static final Instant UPDATED_AT = Instant.parse("2026-01-02T04:05:06Z");
    private static final Instant UPDATED_AFTER_EDIT = Instant.parse("2026-01-02T05:06:07.123456Z");
    private static final UUID REHYDRATED_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");

    @Autowired
    private OAuthAccountRepositoryAdapter oauthAccountRepository;

    @Autowired
    private SpringDataOAuthAccountRepository springDataOAuthAccountRepository;

    @Autowired
    private UserRepositoryAdapter userRepository;

    @Autowired
    private SpringDataUserRepository springDataUserRepository;

    @Autowired
    private TransactionTemplate transactionTemplate;

    @Autowired
    private DataSource dataSource;

    private UUID firstUserId;
    private UUID secondUserId;
    private ExecutorService executor;

    @BeforeEach
    void cleanDatabaseAndCreateUsers() {
        springDataOAuthAccountRepository.deleteAll();
        springDataUserRepository.deleteAll();
        firstUserId = userRepository.save(user("oauth-first@example.com")).getId();
        secondUserId = userRepository.save(user("oauth-second@example.com")).getId();
    }

    @AfterEach
    void stopExecutor() {
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    @Test
    void roundTripsIdentityTimestampsAndNullableProviderEmailWithoutGeneratingNewId() {
        OAuthAccount account = account(
                REHYDRATED_ID,
                firstUserId,
                "provider-sub-1",
                null,
                CREATED_AT,
                UPDATED_AT);

        OAuthAccount saved = oauthAccountRepository.save(account);
        assertEquals(REHYDRATED_ID, saved.getId());
        assertEquals(CREATED_AT, saved.getCreatedAt());
        assertEquals(UPDATED_AT, saved.getUpdatedAt());
        assertNull(saved.getProviderEmail());

        OAuthAccount reloaded = oauthAccountRepository.findById(REHYDRATED_ID).orElseThrow();
        assertEquals(account.getId(), reloaded.getId());
        assertEquals(account.getUserId(), reloaded.getUserId());
        assertEquals(account.getProvider(), reloaded.getProvider());
        assertEquals(account.getProviderUserId(), reloaded.getProviderUserId());
        assertEquals(account.getProviderEmail(), reloaded.getProviderEmail());
        assertEquals(account.getCreatedAt(), reloaded.getCreatedAt());
        assertEquals(account.getUpdatedAt(), reloaded.getUpdatedAt());

        OAuthAccount edited = account(
                REHYDRATED_ID,
                firstUserId,
                "provider-sub-1",
                "provider@example.com",
                CREATED_AT,
                UPDATED_AFTER_EDIT);
        oauthAccountRepository.save(edited);

        OAuthAccount afterUpdate = oauthAccountRepository.findById(REHYDRATED_ID).orElseThrow();
        assertEquals(UPDATED_AFTER_EDIT, afterUpdate.getUpdatedAt());
        assertEquals("provider@example.com", afterUpdate.getProviderEmail());
    }

    @Test
    void findsOAuthAccountByExactProviderSubjectThroughThePublicPort() {
        OAuthAccount account = oauthAccountRepository.save(account(
                UUID.randomUUID(),
                firstUserId,
                "Provider-Subject",
                "provider@example.com",
                CREATED_AT,
                UPDATED_AT));

        assertEquals(
                account.getId(),
                oauthAccountRepository
                        .findByProviderAndProviderUserId(OAuthProvider.GOOGLE, "Provider-Subject")
                        .orElseThrow()
                        .getId());
        assertTrue(oauthAccountRepository
                .findByProviderAndProviderUserId(OAuthProvider.GOOGLE, "missing-subject")
                .isEmpty());
        assertTrue(oauthAccountRepository
                .findByProviderAndProviderUserId(OAuthProvider.GOOGLE, "provider-subject")
                .isEmpty());
    }

    @Test
    void findsListsAndDeletesOnlyWithinTheRequestedOwner() {
        OAuthAccount firstAccount = oauthAccountRepository.save(account(
                UUID.randomUUID(), firstUserId, "first-owner-sub", "first@example.com", CREATED_AT, UPDATED_AT));
        OAuthAccount secondAccount = oauthAccountRepository.save(account(
                UUID.randomUUID(), secondUserId, "second-owner-sub", "second@example.com", CREATED_AT, UPDATED_AT));

        assertEquals(List.of(firstAccount.getId()),
                oauthAccountRepository.findAllByUserId(firstUserId).stream().map(OAuthAccount::getId).toList());
        assertEquals(List.of(secondAccount.getId()),
                oauthAccountRepository.findAllByUserId(secondUserId).stream().map(OAuthAccount::getId).toList());
        assertTrue(oauthAccountRepository.findByIdAndUserId(firstAccount.getId(), firstUserId).isPresent());
        assertTrue(oauthAccountRepository.findByIdAndUserId(firstAccount.getId(), secondUserId).isEmpty());

        Boolean wrongOwnerDeleted = transactionTemplate.execute(status ->
                oauthAccountRepository.deleteByIdAndUserId(firstAccount.getId(), secondUserId));
        assertFalse(wrongOwnerDeleted);
        assertTrue(oauthAccountRepository.findById(firstAccount.getId()).isPresent());

        Boolean ownerDeleted = transactionTemplate.execute(status ->
                oauthAccountRepository.deleteByIdAndUserId(firstAccount.getId(), firstUserId));
        assertTrue(ownerDeleted);
        assertTrue(oauthAccountRepository.findById(firstAccount.getId()).isEmpty());
        assertTrue(oauthAccountRepository.findById(secondAccount.getId()).isPresent());
    }

    @Test
    void existingProviderSubjectConstraintAllowsOnlyOneConcurrentWinner() throws Exception {
        assertSingleConflict(
                account(UUID.randomUUID(), firstUserId, "same-provider-subject", null, CREATED_AT, UPDATED_AT),
                account(UUID.randomUUID(), secondUserId, "same-provider-subject", null, CREATED_AT, UPDATED_AT));
    }

    @Test
    void userProviderConstraintAllowsOnlyOneConcurrentWinner() throws Exception {
        assertSingleConflict(
                account(UUID.randomUUID(), firstUserId, "first-subject", null, CREATED_AT, UPDATED_AT),
                account(UUID.randomUUID(), firstUserId, "second-subject", null, CREATED_AT, UPDATED_AT));
    }

    @Test
    void userProviderMigrationRefusesPreexistingDuplicatesWithoutDeletingRows() {
        JdbcTemplate jdbcTemplate = new JdbcTemplate(dataSource);
        String schema = "oauth_migration_" + UUID.randomUUID().toString().replace("-", "");
        String usersTable = qualified(schema, "users");
        String accountsTable = qualified(schema, "oauth_accounts");
        UUID userId = UUID.randomUUID();

        jdbcTemplate.execute("create schema " + quoted(schema));
        try {
            flyway(schema, MigrationVersion.fromVersion("3")).migrate();
            jdbcTemplate.update(
                    "insert into " + usersTable
                            + " (id, email, system_role, status, created_at, updated_at)"
                            + " values (?, ?, 'USER', 'ACTIVE', ?, ?)",
                    userId,
                    "migration-user@example.com",
                    Timestamp.from(CREATED_AT),
                    Timestamp.from(CREATED_AT));
            jdbcTemplate.update(
                    "insert into " + accountsTable
                            + " (id, user_id, provider, provider_user_id, created_at, updated_at)"
                            + " values (?, ?, 'GOOGLE', ?, ?, ?)",
                    UUID.randomUUID(),
                    userId,
                    "duplicate-subject-1",
                    Timestamp.from(CREATED_AT),
                    Timestamp.from(UPDATED_AT));
            jdbcTemplate.update(
                    "insert into " + accountsTable
                            + " (id, user_id, provider, provider_user_id, created_at, updated_at)"
                            + " values (?, ?, 'GOOGLE', ?, ?, ?)",
                    UUID.randomUUID(),
                    userId,
                    "duplicate-subject-2",
                    Timestamp.from(CREATED_AT),
                    Timestamp.from(UPDATED_AT));

            FlywayException failure = assertThrows(FlywayException.class, () -> flyway(schema, null).migrate());
            assertTrue(failure.getMessage().toLowerCase(Locale.ROOT).contains("duplicate"));
            assertEquals(2, jdbcTemplate.queryForObject(
                    "select count(*) from " + accountsTable,
                    Integer.class));
            assertEquals("3", jdbcTemplate.queryForObject(
                    "select version from " + qualified(schema, "flyway_schema_history")
                            + " where success = true order by installed_rank desc limit 1",
                    String.class));
            assertEquals(0, constraintCount(jdbcTemplate, schema, "uk_oauth_account_user_provider"));
        } finally {
            jdbcTemplate.execute("drop schema " + quoted(schema) + " cascade");
        }
    }

    @Test
    void userProviderMigrationInstallsV4WithoutChangingValidOAuthRows() {
        JdbcTemplate jdbcTemplate = new JdbcTemplate(dataSource);
        String schema = "oauth_migration_valid_" + UUID.randomUUID().toString().replace("-", "");
        String usersTable = qualified(schema, "users");
        String accountsTable = qualified(schema, "oauth_accounts");
        UUID firstMigrationUserId = UUID.fromString("20000000-0000-0000-0000-000000000001");
        UUID secondMigrationUserId = UUID.fromString("20000000-0000-0000-0000-000000000002");
        UUID firstAccountId = UUID.fromString("30000000-0000-0000-0000-000000000001");
        UUID secondAccountId = UUID.fromString("30000000-0000-0000-0000-000000000002");
        Instant firstCreatedAt = Instant.parse("2026-02-03T04:05:06.123456Z");
        Instant firstUpdatedAt = Instant.parse("2026-02-03T05:06:07.654321Z");
        Instant secondCreatedAt = Instant.parse("2026-02-04T04:05:06.123456Z");
        Instant secondUpdatedAt = Instant.parse("2026-02-04T05:06:07.654321Z");

        jdbcTemplate.execute("create schema " + quoted(schema));
        try {
            flyway(schema, MigrationVersion.fromVersion("3")).migrate();
            jdbcTemplate.update(
                    "insert into " + usersTable
                            + " (id, email, system_role, status, created_at, updated_at)"
                            + " values (?, ?, 'USER', 'ACTIVE', ?, ?)",
                    firstMigrationUserId,
                    "migration-valid-first@example.com",
                    Timestamp.from(firstCreatedAt),
                    Timestamp.from(firstUpdatedAt));
            jdbcTemplate.update(
                    "insert into " + usersTable
                            + " (id, email, system_role, status, created_at, updated_at)"
                            + " values (?, ?, 'USER', 'ACTIVE', ?, ?)",
                    secondMigrationUserId,
                    "migration-valid-second@example.com",
                    Timestamp.from(secondCreatedAt),
                    Timestamp.from(secondUpdatedAt));
            jdbcTemplate.update(
                    "insert into " + accountsTable
                            + " (id, user_id, provider, provider_user_id, provider_email, created_at, updated_at)"
                            + " values (?, ?, 'GOOGLE', ?, ?, ?, ?)",
                    firstAccountId,
                    firstMigrationUserId,
                    "valid-subject-1",
                    null,
                    Timestamp.from(firstCreatedAt),
                    Timestamp.from(firstUpdatedAt));
            jdbcTemplate.update(
                    "insert into " + accountsTable
                            + " (id, user_id, provider, provider_user_id, provider_email, created_at, updated_at)"
                            + " values (?, ?, 'GOOGLE', ?, ?, ?, ?)",
                    secondAccountId,
                    secondMigrationUserId,
                    "valid-subject-2",
                    "provider@example.com",
                    Timestamp.from(secondCreatedAt),
                    Timestamp.from(secondUpdatedAt));

            flyway(schema, null).migrate();

            Map<String, Object> firstRow = jdbcTemplate.queryForMap(
                    "select id, user_id, provider, provider_user_id, provider_email, created_at, updated_at"
                            + " from " + accountsTable + " where id = ?",
                    firstAccountId);
            Map<String, Object> secondRow = jdbcTemplate.queryForMap(
                    "select id, user_id, provider, provider_user_id, provider_email, created_at, updated_at"
                            + " from " + accountsTable + " where id = ?",
                    secondAccountId);

            assertOAuthRow(firstRow, firstAccountId, firstMigrationUserId, "valid-subject-1", null,
                    firstCreatedAt, firstUpdatedAt);
            assertOAuthRow(secondRow, secondAccountId, secondMigrationUserId, "valid-subject-2",
                    "provider@example.com", secondCreatedAt, secondUpdatedAt);
            assertEquals("4", jdbcTemplate.queryForObject(
                    "select version from " + qualified(schema, "flyway_schema_history")
                            + " where success = true order by installed_rank desc limit 1",
                    String.class));
            assertEquals(1, constraintCount(jdbcTemplate, schema, "uk_oauth_account_provider_user"));
            assertEquals(1, constraintCount(jdbcTemplate, schema, "uk_oauth_account_user_provider"));
        } finally {
            jdbcTemplate.execute("drop schema " + quoted(schema) + " cascade");
        }
    }

    private void assertSingleConflict(OAuthAccount first, OAuthAccount second) throws Exception {
        executor = Executors.newFixedThreadPool(2);
        CountDownLatch transactionsReady = new CountDownLatch(2);
        CountDownLatch startInsert = new CountDownLatch(1);

        Future<Throwable> firstResult = executor.submit(
                () -> insertConcurrently(first, transactionsReady, startInsert));
        Future<Throwable> secondResult = executor.submit(
                () -> insertConcurrently(second, transactionsReady, startInsert));

        assertTrue(transactionsReady.await(10, SECONDS), "both insert transactions should start");
        startInsert.countDown();

        List<Throwable> outcomes = Arrays.asList(
                firstResult.get(15, SECONDS),
                secondResult.get(15, SECONDS));
        long successes = outcomes.stream().filter(outcome -> outcome == null).count();
        List<Throwable> failures = outcomes.stream().filter(outcome -> outcome != null).toList();

        assertEquals(1, successes);
        assertEquals(1, failures.size());
        ConflictException conflict = assertInstanceOf(ConflictException.class, failures.getFirst());
        assertEquals("A resource conflict occurred", conflict.getMessage());
        assertEquals(1, springDataOAuthAccountRepository.count());
    }

    private Throwable insertConcurrently(
            OAuthAccount account,
            CountDownLatch transactionsReady,
            CountDownLatch startInsert) {
        try {
            transactionTemplate.executeWithoutResult(status -> {
                transactionsReady.countDown();
                await(startInsert);
                oauthAccountRepository.save(account);
            });
            return null;
        } catch (Throwable throwable) {
            return throwable;
        }
    }

    private Flyway flyway(String schema, MigrationVersion target) {
        var configuration = Flyway.configure()
                .dataSource(dataSource)
                .schemas(schema)
                .defaultSchema(schema)
                .locations("classpath:db/migration");
        if (target != null) {
            configuration.target(target);
        }
        return configuration.load();
    }

    private static OAuthAccount account(
            UUID id,
            UUID userId,
            String providerUserId,
            String providerEmail,
            Instant createdAt,
            Instant updatedAt) {
        return new OAuthAccount(
                id,
                userId,
                OAuthProvider.GOOGLE,
                providerUserId,
                providerEmail,
                createdAt,
                updatedAt);
    }

    private static User user(String email) {
        return new User(
                UUID.randomUUID(),
                email,
                "$2a$10$test-password-hash",
                "OAuth Persistence Test",
                null,
                SystemRole.USER,
                UserStatus.ACTIVE,
                CREATED_AT,
                CREATED_AT);
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, SECONDS)) {
                throw new IllegalStateException("timed out waiting for concurrent insert");
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while waiting for concurrent insert", exception);
        }
    }

    private static void assertOAuthRow(
            Map<String, Object> row,
            UUID id,
            UUID userId,
            String providerUserId,
            String providerEmail,
            Instant createdAt,
            Instant updatedAt) {
        assertEquals(id, row.get("id"));
        assertEquals(userId, row.get("user_id"));
        assertEquals("GOOGLE", row.get("provider"));
        assertEquals(providerUserId, row.get("provider_user_id"));
        if (providerEmail == null) {
            assertNull(row.get("provider_email"));
        } else {
            assertEquals(providerEmail, row.get("provider_email"));
        }
        assertEquals(createdAt, ((Timestamp) row.get("created_at")).toInstant());
        assertEquals(updatedAt, ((Timestamp) row.get("updated_at")).toInstant());
    }

    private static int constraintCount(JdbcTemplate jdbcTemplate, String schema, String constraintName) {
        return jdbcTemplate.queryForObject(
                "select count(*) from pg_constraint constraint_row"
                        + " join pg_class table_row on table_row.oid = constraint_row.conrelid"
                        + " join pg_namespace schema_row on schema_row.oid = table_row.relnamespace"
                        + " where schema_row.nspname = ? and table_row.relname = 'oauth_accounts'"
                        + " and constraint_row.conname = ?",
                Integer.class,
                schema,
                constraintName);
    }

    private static String quoted(String identifier) {
        return "\"" + identifier + "\"";
    }

    private static String qualified(String schema, String table) {
        return quoted(schema) + "." + quoted(table);
    }
}
