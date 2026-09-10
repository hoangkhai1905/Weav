package com.weav.identity.infrastructure.persistence;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.dto.ChangePasswordCommand;
import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.application.usecase.ChangePasswordUseCase;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.infrastructure.persistence.repository.SpringDataUserRepository;
import com.weav.identity.infrastructure.persistence.repository.SpringDataUserSessionRepository;
import com.weav.identity.infrastructure.persistence.repository.UserRepositoryAdapter;
import com.weav.identity.infrastructure.persistence.repository.UserSessionRepositoryAdapter;
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

import java.time.Clock;
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
import static org.junit.jupiter.api.Assertions.assertTrue;

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({
        TestcontainersConfiguration.class,
        UserRepositoryAdapter.class,
        UserSessionRepositoryAdapter.class,
        PasswordChangeConcurrencyIntegrationTest.ConcurrencyTestConfiguration.class
})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class PasswordChangeConcurrencyIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-09-05T10:00:00Z");
    private static final String OLD_PASSWORD = "correct-horse-battery-staple";
    private static final String REQUESTED_PASSWORD = "requested-replacement-password";
    private static final String CONCURRENT_PASSWORD = "concurrent-replacement-password";

    @Autowired
    private ChangePasswordUseCase changePasswordUseCase;

    @Autowired
    private GateTransactionRunner transactionRunner;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Autowired
    private UserRepositoryAdapter userRepository;

    @Autowired
    private UserSessionRepositoryAdapter sessionRepository;

    @Autowired
    private SpringDataUserRepository springDataUserRepository;

    @Autowired
    private SpringDataUserSessionRepository springDataUserSessionRepository;

    private ExecutorService executor;
    private UUID userId;
    private UUID sessionId;

    @BeforeEach
    void createActiveIdentity() {
        springDataUserSessionRepository.deleteAll();
        springDataUserRepository.deleteAll();
        userId = userRepository.save(new User(
                UUID.randomUUID(),
                "password-change-race@example.com",
                OLD_PASSWORD,
                "Password Race",
                null,
                SystemRole.USER,
                UserStatus.ACTIVE,
                NOW,
                NOW
        )).getId();
        sessionId = sessionRepository.save(new UserSession(
                UUID.randomUUID(),
                userId,
                "password-change-race-refresh-hash",
                null,
                null,
                NOW.plusSeconds(3600),
                NOW
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
    void stalePreLockPasswordVerificationCannotCommitAfterConcurrentPasswordChange() throws Exception {
        transactionRunner.arm();
        executor = Executors.newSingleThreadExecutor();
        Future<ChangeOutcome> change = executor.submit(this::changePassword);

        assertTrue(transactionRunner.awaitCallerReady(), "password change should verify before taking the user lock");
        replacePasswordUnderUserLock();
        transactionRunner.release();

        ChangeOutcome outcome = change.get(20, SECONDS);
        assertTrue(outcome.failure() != null, "change must not report success");
        assertInstanceOf(UnauthorizedException.class, outcome.failure());
        assertEquals(CONCURRENT_PASSWORD, userRepository.findById(userId).orElseThrow().getPasswordHash());
        assertTrue(sessionRepository.findById(sessionId).orElseThrow().isActive(NOW));
    }

    private ChangeOutcome changePassword() {
        try {
            changePasswordUseCase.execute(
                    userId,
                    sessionId,
                    new ChangePasswordCommand(OLD_PASSWORD, REQUESTED_PASSWORD)
            );
            return new ChangeOutcome(null);
        } catch (Throwable throwable) {
            return new ChangeOutcome(throwable);
        }
    }

    private void replacePasswordUnderUserLock() {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            User locked = userRepository.findByIdForUpdate(userId).orElseThrow();
            locked.changePassword(CONCURRENT_PASSWORD, NOW.plusSeconds(1));
            userRepository.save(locked);
        });
    }

    private record ChangeOutcome(Throwable failure) {
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class ConcurrencyTestConfiguration {

        @Bean
        Clock testClock() {
            return Clock.fixed(NOW, ZoneOffset.UTC);
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
        GateTransactionRunner transactionRunner(PlatformTransactionManager transactionManager) {
            return new GateTransactionRunner(new SpringTransactionRunner(new TransactionTemplate(transactionManager)));
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
        ChangePasswordUseCase changePasswordUseCase(
                CurrentIdentityGuard identityGuard,
                UserRepositoryAdapter userRepository,
                UserSessionRepositoryAdapter sessionRepository,
                PasswordHasher passwordHasher,
                GateTransactionRunner transactionRunner,
                Clock clock
        ) {
            return new ChangePasswordUseCase(
                    identityGuard,
                    userRepository,
                    sessionRepository,
                    passwordHasher,
                    transactionRunner,
                    new AuthInputPolicy(),
                    clock
            );
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
