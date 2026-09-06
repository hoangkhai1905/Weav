package com.weav.identity.infrastructure.persistence;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.domain.exception.ConflictException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.infrastructure.persistence.repository.SpringDataUserRepository;
import com.weav.identity.infrastructure.persistence.repository.UserRepositoryAdapter;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.support.TransactionTemplate;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class UserPersistenceIntegrationTest {

    private static final Instant CREATED_AT = Instant.parse("2026-01-02T03:04:05Z");

    @Autowired
    private UserRepositoryAdapter userRepository;

    @Autowired
    private SpringDataUserRepository springDataUserRepository;

    @Autowired
    private TransactionTemplate transactionTemplate;

    private ExecutorService executor;

    @BeforeEach
    void cleanDatabase() {
        springDataUserRepository.deleteAll();
    }

    @AfterEach
    void stopExecutor() {
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    @Test
    void findsAndChecksExistenceByCaseAndSpaceInsensitiveCanonicalEmail() {
        User persisted = userRepository.save(user("  Mixed.Case@Example.com  "));

        User found = userRepository.findByEmail(" MIXED.CASE@example.COM ").orElseThrow();

        assertEquals(persisted.getId(), found.getId());
        assertEquals("  Mixed.Case@Example.com  ", found.getEmail());
        assertTrue(userRepository.existsByEmail(" mixed.case@EXAMPLE.com "));
    }

    @Test
    void canonicalEmailConstraintAllowsOnlyOneWinnerDuringConcurrentInsertRace() throws Exception {
        assertSingleConflict(
                "Race.User@Example.com",
                "  race.user@example.COM  ");
    }

    @Test
    void legacyExactEmailConstraintIsAlsoTranslatedDuringConcurrentInsertRace() throws Exception {
        assertSingleConflict(
                "exact-race@example.com",
                "exact-race@example.com");
    }

    private void assertSingleConflict(String firstEmail, String secondEmail) throws Exception {
        executor = Executors.newFixedThreadPool(2);
        CountDownLatch transactionsReady = new CountDownLatch(2);
        CountDownLatch startInsert = new CountDownLatch(1);

        Future<Throwable> first = executor.submit(
                () -> insertConcurrently(user(firstEmail), transactionsReady, startInsert));
        Future<Throwable> second = executor.submit(
                () -> insertConcurrently(user(secondEmail), transactionsReady, startInsert));

        assertTrue(transactionsReady.await(10, SECONDS), "both insert transactions should start");
        startInsert.countDown();

        List<Throwable> outcomes = Arrays.asList(first.get(15, SECONDS), second.get(15, SECONDS));
        long successes = outcomes.stream().filter(outcome -> outcome == null).count();
        List<Throwable> failures = outcomes.stream().filter(outcome -> outcome != null).toList();

        assertEquals(1, successes);
        assertEquals(1, failures.size());
        ConflictException conflict = assertInstanceOf(ConflictException.class, failures.getFirst());
        assertEquals("A resource conflict occurred", conflict.getMessage());
        assertEquals(1, springDataUserRepository.count());
    }

    private Throwable insertConcurrently(
            User user,
            CountDownLatch transactionsReady,
            CountDownLatch startInsert) {
        try {
            transactionTemplate.executeWithoutResult(status -> {
                transactionsReady.countDown();
                await(startInsert);
                userRepository.save(user);
            });
            return null;
        } catch (Throwable throwable) {
            return throwable;
        }
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

    private static User user(String email) {
        return new User(
                UUID.randomUUID(),
                email,
                "$2a$10$test-password-hash",
                "Persistence Test",
                null,
                SystemRole.USER,
                UserStatus.ACTIVE,
                CREATED_AT,
                CREATED_AT);
    }
}
