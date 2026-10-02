package com.weav.identity.infrastructure.persistence;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.dto.IssuedAccessToken;
import com.weav.identity.application.dto.LoginCommand;
import com.weav.identity.application.dto.TokenPairResult;
import com.weav.identity.application.dto.UpdateProfileCommand;
import com.weav.identity.application.port.out.AccessTokenIssuer;
import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.RefreshTokenGenerator;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.usecase.LoginUseCase;
import com.weav.identity.application.usecase.UpdateProfileUseCase;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.application.security.CurrentIdentityGuard;
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
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({
        TestcontainersConfiguration.class,
        UserRepositoryAdapter.class,
        UserSessionRepositoryAdapter.class,
        AccountMutationConcurrencyIntegrationTest.ConcurrencyTestConfiguration.class
})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class AccountMutationConcurrencyIntegrationTest {

    private static final Instant CREATED_AT = Instant.parse("2026-01-02T03:04:05Z");
    private static final String OLD_PASSWORD = "correct-horse-battery-staple";
    private static final String NEW_PASSWORD = "replacement-horse-battery-staple";

    @Autowired
    private LoginUseCase loginUseCase;

    @Autowired
    private UpdateProfileUseCase updateProfileUseCase;

    @Autowired
    private GateTransactionRunner transactionRunner;

    @Autowired
    private PlatformTransactionManager transactionManager;

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
    private UUID sessionId;

    @BeforeEach
    void cleanDatabaseAndCreateUser() {
        springDataUserSessionRepository.deleteAll();
        springDataUserRepository.deleteAll();
        userId = userRepository.save(new User(
                UUID.randomUUID(),
                "login-reset-race@example.com",
                OLD_PASSWORD,
                "Login Reset Race",
                null,
                SystemRole.USER,
                UserStatus.ACTIVE,
                CREATED_AT,
                CREATED_AT
        )).getId();
        sessionId = userSessionRepository.save(new UserSession(
                UUID.randomUUID(),
                userId,
                "profile-race-refresh-hash",
                null,
                null,
                Instant.parse("2026-09-12T10:00:00Z"),
                CREATED_AT
        )).getId();
    }

    @AfterEach
    void stopExecutor() {
        transactionRunner.release();
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    @Test
    void stalePasswordLoginCannotIssueSessionAfterLockedPasswordReplacementCommits() throws Exception {
        transactionRunner.arm();
        executor = Executors.newSingleThreadExecutor();
        Future<LoginOutcome> login = executor.submit(this::loginWithOldPassword);

        assertTrue(transactionRunner.awaitCallerReady(), "login should finish its unlocked account lookup");
        replacePasswordUnderUserLock();
        transactionRunner.release();

        LoginOutcome outcome = login.get(20, SECONDS);
        assertNull(outcome.result());
        assertInstanceOf(UnauthorizedException.class, outcome.failure());
        assertEquals("Authentication failed", outcome.failure().getMessage());
        assertEquals(1, springDataUserSessionRepository.count());
        assertEquals(
                NEW_PASSWORD,
                userRepository.findById(userId).orElseThrow().getPasswordHash()
        );
    }

    @Test
    void postGuardSessionRevocationPreventsProfileMutation() throws Exception {
        transactionRunner.arm();
        executor = Executors.newSingleThreadExecutor();
        Future<ProfileOutcome> profileUpdate = executor.submit(this::updateProfile);

        assertTrue(transactionRunner.awaitCallerReady(), "profile update should complete its initial guard");
        revokeAuthorizingSessionUnderUserLock();
        transactionRunner.release();

        ProfileOutcome outcome = profileUpdate.get(20, SECONDS);
        assertNull(outcome.result());
        assertInstanceOf(UnauthorizedException.class, outcome.failure());
        assertEquals("Login Reset Race", userRepository.findById(userId).orElseThrow().getDisplayName());
    }

    private LoginOutcome loginWithOldPassword() {
        try {
            return new LoginOutcome(
                    loginUseCase.execute(new LoginCommand("login-reset-race@example.com", OLD_PASSWORD)),
                    null
            );
        } catch (Throwable throwable) {
            return new LoginOutcome(null, throwable);
        }
    }

    private ProfileOutcome updateProfile() {
        try {
            return new ProfileOutcome(
                    updateProfileUseCase.execute(userId, sessionId, new UpdateProfileCommand("Should not persist")),
                    null
            );
        } catch (Throwable throwable) {
            return new ProfileOutcome(null, throwable);
        }
    }

    private void replacePasswordUnderUserLock() {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            User locked = userRepository.findByIdForUpdate(userId).orElseThrow();
            userRepository.save(new User(
                    locked.getId(),
                    locked.getEmail(),
                    NEW_PASSWORD,
                    locked.getDisplayName(),
                    locked.getAvatarStorageKey(),
                    locked.getSystemRole(),
                    locked.getStatus(),
                    locked.getCreatedAt(),
                    CREATED_AT.plusSeconds(1)
            ));
        });
    }

    private void revokeAuthorizingSessionUnderUserLock() {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            userRepository.findByIdForUpdate(userId).orElseThrow();
            UserSession session = userSessionRepository.findByIdForUpdate(sessionId).orElseThrow();
            session.revoke(CREATED_AT.plusSeconds(1));
            userSessionRepository.save(session);
        });
    }

    private record LoginOutcome(TokenPairResult result, Throwable failure) {
    }

    private record ProfileOutcome(Object result, Throwable failure) {
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class ConcurrencyTestConfiguration {

        @Bean
        Clock testClock() {
            return Clock.fixed(Instant.parse("2026-09-05T10:00:00Z"), ZoneOffset.UTC);
        }

        @Bean
        PasswordHasher passwordHasher() {
            return new PasswordHasher() {
                @Override
                public String hash(String rawPassword) {
                    return rawPassword;
                }

                @Override
                public boolean matches(String rawPassword, String encodedPassword) {
                    return Objects.equals(rawPassword, encodedPassword);
                }
            };
        }

        @Bean
        RefreshTokenGenerator refreshTokenGenerator() {
            return new SecureRefreshTokenGenerator(new SecureRandom());
        }

        @Bean
        AccessTokenIssuer accessTokenIssuer(Clock clock) {
            return (userId, sessionId, systemRole, userStatus) -> new IssuedAccessToken(
                    "access-token-" + sessionId,
                    clock.instant().plus(Duration.ofMinutes(15))
            );
        }

        @Bean
        GateTransactionRunner transactionRunner(PlatformTransactionManager transactionManager) {
            return new GateTransactionRunner(new SpringTransactionRunner(new TransactionTemplate(transactionManager)));
        }

        @Bean
        LoginUseCase loginUseCase(
                UserRepositoryAdapter userRepository,
                UserSessionRepositoryAdapter sessionRepository,
                PasswordHasher passwordHasher,
                RefreshTokenGenerator refreshTokenGenerator,
                AccessTokenIssuer accessTokenIssuer,
                GateTransactionRunner transactionRunner,
                Clock clock
        ) {
            return new LoginUseCase(
                    userRepository,
                    sessionRepository,
                    passwordHasher,
                    refreshTokenGenerator,
                    accessTokenIssuer,
                    transactionRunner,
                    new AuthInputPolicy(),
                    clock,
                    Duration.ofDays(7)
            );
        }

        @Bean
        CurrentIdentityGuard currentIdentityGuard(
                UserRepositoryAdapter userRepository,
                UserSessionRepositoryAdapter sessionRepository,
                Clock clock
        ) {
            return new CurrentIdentityGuard(userRepository, sessionRepository, clock);
        }

        @Bean
        UpdateProfileUseCase updateProfileUseCase(
                CurrentIdentityGuard identityGuard,
                UserRepositoryAdapter userRepository,
                GateTransactionRunner transactionRunner,
                Clock clock
        ) {
            return new UpdateProfileUseCase(identityGuard, userRepository, transactionRunner, clock);
        }
    }

    static final class GateTransactionRunner implements TransactionRunner {

        private final TransactionRunner delegate;
        private final AtomicBoolean armed = new AtomicBoolean();
        private volatile CountDownLatch callerReady = new CountDownLatch(0);
        private volatile CountDownLatch proceed = new CountDownLatch(0);

        GateTransactionRunner(TransactionRunner delegate) {
            this.delegate = delegate;
        }

        void arm() {
            callerReady = new CountDownLatch(1);
            proceed = new CountDownLatch(1);
            armed.set(true);
        }

        boolean awaitCallerReady() throws InterruptedException {
            return callerReady.await(10, SECONDS);
        }

        void release() {
            proceed.countDown();
        }

        @Override
        public <T> T required(java.util.function.Supplier<T> work) {
            if (armed.compareAndSet(true, false)) {
                callerReady.countDown();
                await(proceed);
            }
            return delegate.required(work);
        }

        private static void await(CountDownLatch latch) {
            try {
                if (!latch.await(10, SECONDS)) {
                    throw new IllegalStateException("timed out waiting to enter transaction");
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("interrupted while waiting to enter transaction", exception);
            }
        }
    }
}
