package com.weav.identity.infrastructure.persistence;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.dto.GeneratedRefreshToken;
import com.weav.identity.application.dto.IssuedAccessToken;
import com.weav.identity.application.dto.RefreshTokenCommand;
import com.weav.identity.application.dto.TokenPairResult;
import com.weav.identity.application.port.out.AccessTokenIssuer;
import com.weav.identity.application.port.out.RefreshTokenGenerator;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.usecase.LogoutUseCase;
import com.weav.identity.application.usecase.RefreshSessionUseCase;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.infrastructure.persistence.repository.SpringDataUserRepository;
import com.weav.identity.infrastructure.persistence.repository.SpringDataUserSessionRepository;
import com.weav.identity.infrastructure.persistence.repository.UserRepositoryAdapter;
import com.weav.identity.infrastructure.persistence.repository.UserSessionRepositoryAdapter;
import com.weav.identity.infrastructure.security.SecureRefreshTokenGenerator;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
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
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({
        TestcontainersConfiguration.class,
        UserRepositoryAdapter.class,
        UserSessionRepositoryAdapter.class,
        RefreshConcurrencyIntegrationTest.ConcurrencyTestConfiguration.class
})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class RefreshConcurrencyIntegrationTest {

    private static final Instant CREATED_AT = Instant.parse("2026-01-02T03:04:05Z");
    private static final Instant EXPIRES_AT = Instant.parse("2030-01-02T03:04:05Z");

    @Autowired
    private RefreshSessionUseCase refreshSessionUseCase;

    @Autowired
    private LogoutUseCase logoutUseCase;

    @Autowired
    private RefreshTokenGenerator refreshTokenGenerator;

    @Autowired
    private UserRepositoryAdapter userRepository;

    @Autowired
    private UserSessionRepositoryAdapter userSessionRepository;

    @Autowired
    private SpringDataUserRepository springDataUserRepository;

    @Autowired
    private SpringDataUserSessionRepository springDataUserSessionRepository;

    private ExecutorService executor;
    private UUID userId;

    @BeforeEach
    void cleanDatabaseAndCreateUser() {
        springDataUserSessionRepository.deleteAll();
        springDataUserRepository.deleteAll();
        userId = userRepository.save(new User(
                UUID.randomUUID(),
                "refresh-race@example.com",
                "$2a$10$test-password-hash",
                "Refresh Race",
                null,
                SystemRole.USER,
                UserStatus.ACTIVE,
                CREATED_AT,
                CREATED_AT)).getId();
    }

    @AfterEach
    void stopExecutor() {
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    @Test
    void onlyOneConcurrentRefreshCanRotateTheSameToken() throws Exception {
        SessionFixture fixture = persistSession();
        executor = Executors.newFixedThreadPool(2);
        CountDownLatch callersReady = new CountDownLatch(2);
        CountDownLatch startCalls = new CountDownLatch(1);

        Future<RefreshOutcome> first = executor.submit(
                () -> refreshConcurrently(fixture.rawToken(), callersReady, startCalls));
        Future<RefreshOutcome> second = executor.submit(
                () -> refreshConcurrently(fixture.rawToken(), callersReady, startCalls));

        assertTrue(callersReady.await(10, SECONDS), "both refresh callers should be ready");
        startCalls.countDown();

        List<RefreshOutcome> outcomes = List.of(first.get(20, SECONDS), second.get(20, SECONDS));
        List<TokenPairResult> successes = outcomes.stream()
                .map(RefreshOutcome::result)
                .filter(result -> result != null)
                .toList();
        List<Throwable> failures = outcomes.stream()
                .map(RefreshOutcome::failure)
                .filter(failure -> failure != null)
                .toList();

        // Inside the reuse grace window the loser is treated as a retry: both calls succeed, serialized by
        // the row lock, and the session ends with the second token current and the first one previous.
        assertEquals(2, successes.size());
        assertTrue(failures.isEmpty());

        String firstHash = refreshTokenGenerator.hash(successes.get(0).refreshToken());
        String secondHash = refreshTokenGenerator.hash(successes.get(1).refreshToken());
        UserSession stored = userSessionRepository.findById(fixture.sessionId()).orElseThrow();

        assertTrue(stored.getRefreshTokenHash().equals(firstHash) || stored.getRefreshTokenHash().equals(secondHash));
        assertTrue(stored.getPreviousRefreshTokenHash().equals(firstHash)
                || stored.getPreviousRefreshTokenHash().equals(secondHash));
        assertTrue(!stored.getRefreshTokenHash().equals(stored.getPreviousRefreshTokenHash()));
        assertNull(stored.getRevokedAt());
        assertEquals(EXPIRES_AT, stored.getExpiresAt());
        assertTrue(userSessionRepository.findByRefreshTokenHash(fixture.oldHash()).isEmpty());
    }

    @Test
    void retryWithPreviousTokenInsideGraceSucceedsAndOutsideGraceRevokesSession() {
        SessionFixture fixture = persistSession();
        TokenPairResult first = refreshSessionUseCase.execute(new RefreshTokenCommand(fixture.rawToken()));
        UserSession rotated = userSessionRepository.findById(fixture.sessionId()).orElseThrow();
        assertEquals(fixture.oldHash(), rotated.getPreviousRefreshTokenHash());
        assertNotNull(rotated.getRotatedAt());

        // Retry with the old token inside the 10 s grace (fixed test clock): issues a new pair.
        TokenPairResult retry = refreshSessionUseCase.execute(new RefreshTokenCommand(fixture.rawToken()));
        assertTrue(!retry.refreshToken().equals(first.refreshToken()));

        // Age the rotation beyond the grace window, then replay the previous token: reuse detected.
        UserSession stored = userSessionRepository.findById(fixture.sessionId()).orElseThrow();
        userSessionRepository.save(new UserSession(stored.getId(), stored.getUserId(),
                stored.getRefreshTokenHash(), stored.getUserAgent(), stored.getIpAddress(),
                stored.getExpiresAt(), null, stored.getLastUsedAt(), stored.getCreatedAt(),
                stored.getPreviousRefreshTokenHash(), stored.getRotatedAt().minusSeconds(60)));

        // retry's previous hash is first.refreshToken() hash (the token replaced by the retry rotation).
        assertThrows(UnauthorizedException.class,
                () -> refreshSessionUseCase.execute(new RefreshTokenCommand(first.refreshToken())));
        assertNotNull(userSessionRepository.findById(fixture.sessionId()).orElseThrow().getRevokedAt());
        assertThrows(UnauthorizedException.class,
                () -> refreshSessionUseCase.execute(new RefreshTokenCommand(retry.refreshToken())));
    }

    @Test
    void refreshRacingLogoutProducesOneOfTwoSerializedLockOutcomes() throws Exception {
        SessionFixture fixture = persistSession();
        executor = Executors.newFixedThreadPool(2);
        CountDownLatch callersReady = new CountDownLatch(2);
        CountDownLatch startCalls = new CountDownLatch(1);

        Future<RefreshOutcome> refresh = executor.submit(
                () -> refreshConcurrently(fixture.rawToken(), callersReady, startCalls));
        Future<Throwable> logout = executor.submit(
                () -> logoutConcurrently(fixture.rawToken(), callersReady, startCalls));

        assertTrue(callersReady.await(10, SECONDS), "refresh and logout callers should be ready");
        startCalls.countDown();

        RefreshOutcome refreshOutcome = refresh.get(20, SECONDS);
        assertNull(logout.get(20, SECONDS), "logout should remain idempotent");
        UserSession stored = userSessionRepository.findById(fixture.sessionId()).orElseThrow();

        assertEquals(fixture.sessionId(), stored.getId());
        assertEquals(EXPIRES_AT, stored.getExpiresAt());
        if (refreshOutcome.result() != null) {
            String winnerHash = refreshTokenGenerator.hash(refreshOutcome.result().refreshToken());
            assertEquals(winnerHash, stored.getRefreshTokenHash());
            assertNull(stored.getRevokedAt());
            assertTrue(userSessionRepository.findByRefreshTokenHash(fixture.oldHash()).isEmpty());
        } else {
            assertInstanceOf(UnauthorizedException.class, refreshOutcome.failure());
            assertEquals(fixture.oldHash(), stored.getRefreshTokenHash());
            assertNotNull(stored.getRevokedAt());
            assertEquals(fixture.sessionId(),
                    userSessionRepository.findByRefreshTokenHash(fixture.oldHash()).orElseThrow().getId());
        }
    }

    private SessionFixture persistSession() {
        GeneratedRefreshToken token = refreshTokenGenerator.generate();
        UUID sessionId = UUID.randomUUID();
        userSessionRepository.save(new UserSession(
                sessionId,
                userId,
                token.hash(),
                "JUnit",
                "127.0.0.1",
                EXPIRES_AT,
                null,
                null,
                CREATED_AT));
        return new SessionFixture(sessionId, token.value(), token.hash());
    }

    private RefreshOutcome refreshConcurrently(
            String rawToken,
            CountDownLatch callersReady,
            CountDownLatch startCalls) {
        callersReady.countDown();
        await(startCalls);
        try {
            return new RefreshOutcome(
                    refreshSessionUseCase.execute(new RefreshTokenCommand(rawToken)),
                    null);
        } catch (Throwable throwable) {
            return new RefreshOutcome(null, throwable);
        }
    }

    private Throwable logoutConcurrently(
            String rawToken,
            CountDownLatch callersReady,
            CountDownLatch startCalls) {
        callersReady.countDown();
        await(startCalls);
        try {
            logoutUseCase.execute(new RefreshTokenCommand(rawToken));
            return null;
        } catch (Throwable throwable) {
            return throwable;
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, SECONDS)) {
                throw new IllegalStateException("timed out waiting for concurrent call");
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while waiting for concurrent call", exception);
        }
    }

    private record SessionFixture(UUID sessionId, String rawToken, String oldHash) {
    }

    private record RefreshOutcome(TokenPairResult result, Throwable failure) {
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class ConcurrencyTestConfiguration {

        @Bean
        Clock testClock() {
            return Clock.fixed(Instant.parse("2026-09-05T10:00:00Z"), ZoneOffset.UTC);
        }

        @Bean
        RefreshTokenGenerator refreshTokenGenerator() {
            return new SecureRefreshTokenGenerator(new SecureRandom());
        }

        @Bean
        AccessTokenIssuer accessTokenIssuer(Clock clock) {
            return (userId, sessionId, systemRole, userStatus) -> new IssuedAccessToken(
                    "access-token-" + sessionId,
                    clock.instant().plus(Duration.ofMinutes(15)));
        }

        @Bean
        TransactionRunner transactionRunner(PlatformTransactionManager transactionManager) {
            return new SpringTransactionRunner(new TransactionTemplate(transactionManager));
        }

        @Bean
        RefreshSessionUseCase refreshSessionUseCase(
                UserRepositoryAdapter userRepository,
                UserSessionRepositoryAdapter userSessionRepository,
                RefreshTokenGenerator refreshTokenGenerator,
                AccessTokenIssuer accessTokenIssuer,
                TransactionRunner transactionRunner,
                Clock clock
        ) {
            return new RefreshSessionUseCase(
                    userRepository,
                    userSessionRepository,
                    refreshTokenGenerator,
                    accessTokenIssuer,
                    transactionRunner,
                    clock);
        }

        @Bean
        LogoutUseCase logoutUseCase(
                UserRepositoryAdapter userRepository,
                UserSessionRepositoryAdapter userSessionRepository,
                RefreshTokenGenerator refreshTokenGenerator,
                TransactionRunner transactionRunner,
                Clock clock
        ) {
            return new LogoutUseCase(
                    userRepository,
                    userSessionRepository,
                    refreshTokenGenerator,
                    transactionRunner,
                    clock);
        }
    }
}
