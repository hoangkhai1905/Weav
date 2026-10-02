package com.weav.identity.infrastructure.persistence;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.dto.AuthenticatedUserResult;
import com.weav.identity.application.dto.GeneratedRefreshToken;
import com.weav.identity.application.dto.IssuedAccessToken;
import com.weav.identity.application.dto.RegisterUserCommand;
import com.weav.identity.application.dto.TokenPairResult;
import com.weav.identity.application.port.out.AccessTokenIssuer;
import com.weav.identity.application.port.out.OAuthProviderClient;
import com.weav.identity.application.port.out.OAuthTransactionStore;
import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.RefreshTokenGenerator;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.usecase.CompleteGoogleLoginUseCase;
import com.weav.identity.application.usecase.RegisterUserUseCase;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.domain.exception.ConflictException;
import com.weav.identity.domain.exception.OAuthAccountLinkRequiredException;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.model.OAuthAccount;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.port.out.OAuthAccountRepository;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;
import com.weav.identity.domain.valueobject.OAuthProvider;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.infrastructure.persistence.repository.OAuthAccountRepositoryAdapter;
import com.weav.identity.infrastructure.persistence.repository.SpringDataOAuthAccountRepository;
import com.weav.identity.infrastructure.persistence.repository.SpringDataUserRepository;
import com.weav.identity.infrastructure.persistence.repository.SpringDataUserSessionRepository;
import com.weav.identity.infrastructure.persistence.repository.UserRepositoryAdapter;
import com.weav.identity.infrastructure.persistence.repository.UserSessionRepositoryAdapter;
import com.weav.identity.infrastructure.security.SecureRefreshTokenGenerator;
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

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({
        TestcontainersConfiguration.class,
        UserRepositoryAdapter.class,
        OAuthAccountRepositoryAdapter.class,
        UserSessionRepositoryAdapter.class,
        CompleteGoogleLoginPersistenceIntegrationTest.IntegrationConfiguration.class
})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class CompleteGoogleLoginPersistenceIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-09-09T10:15:30Z");
    private static final Instant CREATED_AT = Instant.parse("2026-09-09T09:15:30Z");
    private static final Duration SESSION_LIFETIME = Duration.ofDays(7);

    @Autowired
    private CompleteGoogleLoginUseCase googleLogin;

    @Autowired
    private UserRepositoryAdapter userRepository;

    @Autowired
    private OAuthAccountRepositoryAdapter oauthAccountRepository;

    @Autowired
    private UserSessionRepositoryAdapter sessionRepository;

    @Autowired
    private SpringDataUserRepository springDataUserRepository;

    @Autowired
    private SpringDataOAuthAccountRepository springDataOAuthAccountRepository;

    @Autowired
    private SpringDataUserSessionRepository springDataUserSessionRepository;

    @Autowired
    private RefreshTokenGenerator refreshTokenGenerator;

    @Autowired
    private AccessTokenIssuer accessTokenIssuer;

    @Autowired
    private TransactionRunner transactionRunner;

    @Autowired
    private PlatformTransactionManager transactionManager;

    private ExecutorService executor;

    @BeforeEach
    void cleanDatabase() {
        springDataUserSessionRepository.deleteAll();
        springDataOAuthAccountRepository.deleteAll();
        springDataUserRepository.deleteAll();
    }

    @AfterEach
    void stopExecutor() {
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    @Test
    void linkedActiveSubjectOnlyLoginUsesExistingUserAndConfiguredSessionLifetime() {
        UUID userId = UUID.randomUUID();
        Instant verifiedAt = NOW.minus(Duration.ofDays(1));
        userRepository.save(user(
                userId,
                "Local@Example.com",
                "local-password-hash",
                UserStatus.ACTIVE,
                verifiedAt));
        oauthAccountRepository.save(account(userId, "CaseSensitive-Subject", "old@provider.example"));

        TokenPairResult result = googleLogin.execute(loginHandoff(identity(
                "CaseSensitive-Subject", null, false, null)));

        assertEquals(userId, result.user().id());
        assertEquals("Local@Example.com", result.user().email());
        assertEquals(verifiedAt, result.user().emailVerifiedAt());
        assertEquals(NOW.plus(SESSION_LIFETIME), result.refreshExpiresAt());
        assertEquals(1, springDataUserRepository.count());
        assertEquals(1, springDataOAuthAccountRepository.count());
        assertEquals(1, springDataUserSessionRepository.count());
        assertEquals("old@provider.example",
                oauthAccountRepository.findByProviderAndProviderUserId(
                        OAuthProvider.GOOGLE, "CaseSensitive-Subject").orElseThrow().getProviderEmail());
    }

    @Test
    void linkedDisabledUserCannotCreateSession() {
        UUID userId = UUID.randomUUID();
        userRepository.save(user(userId, "disabled@example.com", "hash", UserStatus.DISABLED, null));
        oauthAccountRepository.save(account(userId, "disabled-subject", "disabled@example.com"));

        assertThrows(UnauthorizedException.class,
                () -> googleLogin.execute(loginHandoff(
                        identity("disabled-subject", null, false, null))));

        assertEquals(1, springDataUserRepository.count());
        assertEquals(1, springDataOAuthAccountRepository.count());
        assertEquals(0, springDataUserSessionRepository.count());
    }

    @Test
    void newGoogleUserPersistsVerifiedAuthorityAndNoLocalPassword() {
        TokenPairResult result = googleLogin.execute(loginHandoff(identity(
                "new-subject", "new.user@GMAIL.com", true, null)));

        User persisted = userRepository.findById(result.user().id()).orElseThrow();
        OAuthAccount account = oauthAccountRepository
                .findByProviderAndProviderUserId(OAuthProvider.GOOGLE, "new-subject")
                .orElseThrow();

        assertEquals("new.user@gmail.com", persisted.getEmail());
        assertNull(persisted.getPasswordHash());
        assertEquals(NOW, persisted.getEmailVerifiedAt());
        assertEquals(persisted.getId(), account.getUserId());
        assertEquals("new.user@gmail.com", account.getProviderEmail());
        assertEquals(1, springDataUserRepository.count());
        assertEquals(1, springDataOAuthAccountRepository.count());
        assertEquals(1, springDataUserSessionRepository.count());
    }

    @Test
    void verifiedThirdPartyEmailRemainsUnverifiedForOtp() {
        TokenPairResult result = googleLogin.execute(loginHandoff(identity(
                "third-party-subject", "new.user@example.net", true, null)));

        User persisted = userRepository.findById(result.user().id()).orElseThrow();
        assertNull(persisted.getEmailVerifiedAt());
        assertNull(persisted.getPasswordHash());
    }

    @Test
    void localEmailCollisionRequiresExplicitLinkAndWritesNothing() {
        UUID localId = UUID.randomUUID();
        userRepository.save(user(localId, "local@example.com", "password-hash", UserStatus.ACTIVE, null));

        OAuthAccountLinkRequiredException failure = assertThrows(
                OAuthAccountLinkRequiredException.class,
                () -> googleLogin.execute(loginHandoff(
                        identity("unlinked-subject", "LOCAL@example.com", true, null)))
        );

        assertEquals("ACCOUNT_LINK_REQUIRED", failure.getCode());
        assertEquals(1, springDataUserRepository.count());
        assertEquals(0, springDataOAuthAccountRepository.count());
        assertEquals(0, springDataUserSessionRepository.count());
    }

    @Test
    void injectedOAuthPersistenceFailureRollsBackUserAccountAndSessionTogether() {
        OAuthAccountRepository failingRepository = new FailingSaveOAuthAccountRepository(oauthAccountRepository);
        CompleteGoogleLoginUseCase failingUseCase = useCase(failingRepository, accessTokenIssuer, transactionRunner);

        assertThrows(IllegalStateException.class,
                () -> failingUseCase.execute(loginHandoff(
                        identity("rollback-subject", "rollback@gmail.com", true, null))));

        assertEquals(0, springDataUserRepository.count());
        assertEquals(0, springDataOAuthAccountRepository.count());
        assertEquals(0, springDataUserSessionRepository.count());
    }

    @Test
    void injectedAccessTokenFailureRollsBackNewUserOAuthAccountAndSessionTogether() {
        AccessTokenIssuer failingIssuer = (userId, sessionId, systemRole, userStatus) -> {
            throw new IllegalStateException("injected access-token failure");
        };
        CompleteGoogleLoginUseCase failingUseCase = useCase(
                userRepository,
                oauthAccountRepository,
                failingIssuer,
                transactionRunner);

        assertThrows(IllegalStateException.class,
                () -> failingUseCase.execute(loginHandoff(
                        identity("access-failure-subject", "access-failure@gmail.com", true, null))));

        assertEquals(0, springDataUserRepository.count());
        assertEquals(0, springDataOAuthAccountRepository.count());
        assertEquals(0, springDataUserSessionRepository.count());
    }

    @Test
    void linkedLoginAccessTokenFailureRollsBackSessionButPreservesExistingAccount() {
        UUID userId = UUID.randomUUID();
        userRepository.save(user(userId, "linked@example.com", "local-hash", UserStatus.ACTIVE, null));
        oauthAccountRepository.save(account(userId, "linked-access-failure-subject", "person@gmail.com"));
        AccessTokenIssuer failingIssuer = (id, sessionId, systemRole, userStatus) -> {
            throw new IllegalStateException("injected linked access-token failure");
        };
        CompleteGoogleLoginUseCase failingUseCase = useCase(
                userRepository,
                oauthAccountRepository,
                failingIssuer,
                transactionRunner);

        assertThrows(IllegalStateException.class,
                () -> failingUseCase.execute(loginHandoff(
                        identity("linked-access-failure-subject", null, false, null))));

        assertEquals(1, springDataUserRepository.count());
        assertEquals(1, springDataOAuthAccountRepository.count());
        assertEquals(0, springDataUserSessionRepository.count());
    }

    @Test
    void concurrentDuplicateNewSubjectLoginsProduceOneWinnerAndNoOrphans() throws Exception {
        BlockingOAuthSubjectRepository gatedAccounts = new BlockingOAuthSubjectRepository(oauthAccountRepository);
        CompleteGoogleLoginUseCase concurrentUseCase = useCase(
                userRepository,
                gatedAccounts,
                accessTokenIssuer,
                transactionRunner);
        OAuthProviderClient.ProviderIdentity identity = identity(
                "duplicate-subject", "first@gmail.com", true, null);

        executor = Executors.newFixedThreadPool(2);
        Future<Outcome> first = executor.submit(() -> execute(concurrentUseCase, identity));
        Future<Outcome> second = executor.submit(() -> execute(concurrentUseCase,
                identity("duplicate-subject", "second@example.net", true, null)));
        assertTrue(gatedAccounts.awaitRechecks(), "both OAuth subject rechecks should observe absence");
        gatedAccounts.release();

        List<Outcome> outcomes = List.of(first.get(20, SECONDS), second.get(20, SECONDS));
        assertEquals(1, outcomes.stream().filter(outcome -> outcome.result() != null).count());
        assertEquals(1, outcomes.stream().filter(outcome -> outcome.failure() != null).count());
        assertTrue(outcomes.stream().map(Outcome::failure).filter(java.util.Objects::nonNull)
                .allMatch(failure -> failure instanceof ConflictException));
        assertEquals(1, springDataUserRepository.count());
        assertEquals(1, springDataOAuthAccountRepository.count());
        assertEquals(1, springDataUserSessionRepository.count());
    }

    @Test
    void localRegistrationRaceLeavesEitherACompleteLocalAccountOrACompleteOAuthAccount() throws Exception {
        BlockingEmailDecisionUserRepository gatedUsers = new BlockingEmailDecisionUserRepository(userRepository);
        CompleteGoogleLoginUseCase concurrentGoogle = useCase(
                gatedUsers,
                oauthAccountRepository,
                accessTokenIssuer,
                transactionRunner);
        PasswordHasher passwordHasher = new PasswordHasher() {
            @Override
            public String hash(String rawPassword) {
                return "local-hash:" + rawPassword;
            }

            @Override
            public boolean matches(String rawPassword, String encodedPassword) {
                return false;
            }
        };
        RegisterUserUseCase concurrentRegister = new RegisterUserUseCase(
                gatedUsers,
                passwordHasher,
                transactionRunner,
                new AuthInputPolicy(),
                Clock.fixed(NOW, ZoneOffset.UTC));

        executor = Executors.newFixedThreadPool(2);
        Future<Outcome> google = executor.submit(() -> execute(
                concurrentGoogle,
                identity("registration-race-subject", "registration-race@example.com", true, null)));
        Future<RegistrationOutcome> local = executor.submit(() -> register(
                concurrentRegister,
                new RegisterUserCommand("registration-race@example.com", "password-123", "Local")));

        assertTrue(gatedUsers.awaitDecisions(), "both account decisions should observe an absent email");
        gatedUsers.release();

        Outcome googleOutcome = google.get(20, SECONDS);
        RegistrationOutcome localOutcome = local.get(20, SECONDS);
        assertEquals(1, (googleOutcome.result() == null ? 0 : 1)
                + (localOutcome.result() == null ? 0 : 1));
        if (googleOutcome.failure() != null) {
            assertTrue(googleOutcome.failure() instanceof ConflictException
                    || googleOutcome.failure() instanceof OAuthAccountLinkRequiredException);
        }
        if (localOutcome.failure() != null) {
            assertInstanceOf(ConflictException.class, localOutcome.failure());
        }
        assertEquals(1, springDataUserRepository.count());
        assertTrue(springDataOAuthAccountRepository.count() == 0
                || springDataOAuthAccountRepository.count() == 1);
        assertTrue(springDataUserSessionRepository.count() == 0
                || springDataUserSessionRepository.count() == 1);
        if (springDataOAuthAccountRepository.count() == 1) {
            assertEquals(1, springDataUserSessionRepository.count());
            assertEquals(1, springDataUserRepository.count());
            User persisted = userRepository.findByEmail("registration-race@example.com").orElseThrow();
            assertNull(persisted.getPasswordHash());
            assertEquals(persisted.getId(), oauthAccountRepository
                    .findByProviderAndProviderUserId(OAuthProvider.GOOGLE, "registration-race-subject")
                    .orElseThrow().getUserId());
            assertEquals(persisted.getId(), springDataUserSessionRepository.findAll().get(0).getUserId());
        } else {
            assertEquals(0, springDataUserSessionRepository.count());
            User persisted = userRepository.findByEmail("registration-race@example.com").orElseThrow();
            assertNotNull(persisted.getPasswordHash());
        }
    }

    private Outcome execute(
            CompleteGoogleLoginUseCase useCase,
            OAuthProviderClient.ProviderIdentity identity) {
        try {
            return new Outcome(useCase.execute(loginHandoff(identity)), null);
        } catch (Throwable failure) {
            return new Outcome(null, failure);
        }
    }

    private RegistrationOutcome register(
            RegisterUserUseCase useCase,
            RegisterUserCommand command) {
        try {
            return new RegistrationOutcome(useCase.execute(command), null);
        } catch (Throwable failure) {
            return new RegistrationOutcome(null, failure);
        }
    }

    private CompleteGoogleLoginUseCase useCase(
            OAuthAccountRepository accounts,
            AccessTokenIssuer tokenIssuer,
            TransactionRunner runner) {
        return useCase(userRepository, accounts, tokenIssuer, runner);
    }

    private CompleteGoogleLoginUseCase useCase(
            UserRepository users,
            OAuthAccountRepository accounts,
            AccessTokenIssuer tokenIssuer,
            TransactionRunner runner) {
        return new CompleteGoogleLoginUseCase(
                users,
                accounts,
                sessionRepository,
                refreshTokenGenerator,
                tokenIssuer,
                runner,
                new AuthInputPolicy(),
                Clock.fixed(NOW, ZoneOffset.UTC),
                SESSION_LIFETIME);
    }

    private static OAuthProviderClient.ProviderIdentity identity(
            String subject,
            String email,
            boolean emailVerified,
            String hostedDomain) {
        return new OAuthProviderClient.ProviderIdentity(
                OAuthProvider.GOOGLE,
                subject,
                email,
                emailVerified,
                hostedDomain,
                NOW);
    }

    private static OAuthTransactionStore.Handoff loginHandoff(
            OAuthProviderClient.ProviderIdentity identity) {
        return new OAuthTransactionStore.Handoff(
                "h".repeat(43),
                "t".repeat(43),
                OAuthTransactionStore.Intent.LOGIN,
                "web",
                "web",
                "c".repeat(43),
                identity,
                null,
                null,
                null,
                Duration.ofSeconds(60),
                5
        );
    }

    private static User user(
            UUID id,
            String email,
            String passwordHash,
            UserStatus status,
            Instant verifiedAt) {
        return new User(
                id,
                email,
                passwordHash,
                "Identity Test",
                null,
                SystemRole.USER,
                status,
                CREATED_AT,
                CREATED_AT,
                verifiedAt);
    }

    private static OAuthAccount account(UUID userId, String subject, String providerEmail) {
        return new OAuthAccount(
                UUID.randomUUID(),
                userId,
                OAuthProvider.GOOGLE,
                subject,
                providerEmail,
                CREATED_AT,
                CREATED_AT);
    }

    private record Outcome(TokenPairResult result, Throwable failure) {
    }

    private record RegistrationOutcome(AuthenticatedUserResult result, Throwable failure) {
    }

    private static final class FailingSaveOAuthAccountRepository implements OAuthAccountRepository {
        private final OAuthAccountRepository delegate;

        private FailingSaveOAuthAccountRepository(OAuthAccountRepository delegate) {
            this.delegate = delegate;
        }

        @Override
        public OAuthAccount save(OAuthAccount account) {
            delegate.save(account);
            throw new IllegalStateException("injected OAuth persistence failure");
        }

        @Override
        public Optional<OAuthAccount> findById(UUID id) {
            return delegate.findById(id);
        }

        @Override
        public Optional<OAuthAccount> findByProviderAndProviderUserId(
                OAuthProvider provider,
                String providerUserId) {
            return delegate.findByProviderAndProviderUserId(provider, providerUserId);
        }

        @Override
        public Optional<OAuthAccount> findByIdAndUserId(UUID id, UUID userId) {
            return delegate.findByIdAndUserId(id, userId);
        }

        @Override
        public List<OAuthAccount> findAllByUserId(UUID userId) {
            return delegate.findAllByUserId(userId);
        }

        @Override
        public boolean deleteByIdAndUserId(UUID id, UUID userId) {
            return delegate.deleteByIdAndUserId(id, userId);
        }
    }

    private static final class BlockingOAuthSubjectRepository implements OAuthAccountRepository {
        private final OAuthAccountRepository delegate;
        private final ThreadLocal<Integer> lookupCounts = ThreadLocal.withInitial(() -> 0);
        private final CountDownLatch rechecksReady = new CountDownLatch(2);
        private final CountDownLatch proceed = new CountDownLatch(1);

        private BlockingOAuthSubjectRepository(OAuthAccountRepository delegate) {
            this.delegate = delegate;
        }

        boolean awaitRechecks() throws InterruptedException {
            return rechecksReady.await(10, SECONDS);
        }

        void release() {
            proceed.countDown();
        }

        @Override
        public OAuthAccount save(OAuthAccount account) {
            return delegate.save(account);
        }

        @Override
        public Optional<OAuthAccount> findById(UUID id) {
            return delegate.findById(id);
        }

        @Override
        public Optional<OAuthAccount> findByProviderAndProviderUserId(
                OAuthProvider provider,
                String providerUserId) {
            Optional<OAuthAccount> result = delegate.findByProviderAndProviderUserId(provider, providerUserId);
            int lookupNumber = lookupCounts.get() + 1;
            lookupCounts.set(lookupNumber);
            if (result.isEmpty() && lookupNumber == 2) {
                rechecksReady.countDown();
                awaitRelease();
            }
            return result;
        }

        @Override
        public Optional<OAuthAccount> findByIdAndUserId(UUID id, UUID userId) {
            return delegate.findByIdAndUserId(id, userId);
        }

        @Override
        public List<OAuthAccount> findAllByUserId(UUID userId) {
            return delegate.findAllByUserId(userId);
        }

        @Override
        public boolean deleteByIdAndUserId(UUID id, UUID userId) {
            return delegate.deleteByIdAndUserId(id, userId);
        }

        private void awaitRelease() {
            try {
                if (!proceed.await(10, SECONDS)) {
                    throw new IllegalStateException("timed out waiting for OAuth subject rechecks");
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("interrupted while waiting for OAuth subject rechecks", exception);
            }
        }
    }

    private static final class BlockingEmailDecisionUserRepository implements UserRepository {
        private final UserRepository delegate;
        private final CountDownLatch decisionsReady = new CountDownLatch(2);
        private final CountDownLatch proceed = new CountDownLatch(1);

        private BlockingEmailDecisionUserRepository(UserRepository delegate) {
            this.delegate = delegate;
        }

        boolean awaitDecisions() throws InterruptedException {
            return decisionsReady.await(10, SECONDS);
        }

        void release() {
            proceed.countDown();
        }

        @Override
        public User save(User user) {
            return delegate.save(user);
        }

        @Override
        public Optional<User> findById(UUID id) {
            return delegate.findById(id);
        }

        @Override
        public Optional<User> findByIdForUpdate(UUID id) {
            return delegate.findByIdForUpdate(id);
        }

        @Override
        public Optional<User> findByEmail(String email) {
            Optional<User> result = delegate.findByEmail(email);
            if (result.isEmpty()) {
                awaitRelease();
            }
            return result;
        }

        @Override
        public boolean existsByEmail(String email) {
            boolean exists = delegate.existsByEmail(email);
            if (!exists) {
                awaitRelease();
            }
            return exists;
        }

        private void awaitRelease() {
            decisionsReady.countDown();
            try {
                if (!proceed.await(10, SECONDS)) {
                    throw new IllegalStateException("timed out waiting for email decisions");
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("interrupted while waiting for email decisions", exception);
            }
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class IntegrationConfiguration {

        @Bean
        Clock testClock() {
            return Clock.fixed(NOW, ZoneOffset.UTC);
        }

        @Bean
        RefreshTokenGenerator refreshTokenGenerator() {
            return new SecureRefreshTokenGenerator(new SecureRandom());
        }

        @Bean
        AccessTokenIssuer accessTokenIssuer(Clock clock) {
            return (userId, sessionId, systemRole, userStatus) -> new IssuedAccessToken(
                    "access-" + sessionId,
                    clock.instant().plus(Duration.ofMinutes(15)));
        }

        @Bean
        TransactionRunner transactionRunner(PlatformTransactionManager transactionManager) {
            return new SpringTransactionRunner(new TransactionTemplate(transactionManager));
        }

        @Bean
        CompleteGoogleLoginUseCase completeGoogleLoginUseCase(
                UserRepository userRepository,
                OAuthAccountRepository oauthAccountRepository,
                UserSessionRepository sessionRepository,
                RefreshTokenGenerator refreshTokenGenerator,
                AccessTokenIssuer accessTokenIssuer,
                TransactionRunner transactionRunner,
                Clock clock) {
            return new CompleteGoogleLoginUseCase(
                    userRepository,
                    oauthAccountRepository,
                    sessionRepository,
                    refreshTokenGenerator,
                    accessTokenIssuer,
                    transactionRunner,
                    new AuthInputPolicy(),
                    clock,
                    SESSION_LIFETIME);
        }
    }
}
