package com.weav.identity.infrastructure.persistence;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.dto.OAuthAccountMetadata;
import com.weav.identity.application.dto.OAuthSecret;
import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OAuthProviderClient;
import com.weav.identity.application.port.out.OAuthTransactionStore;
import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.application.usecase.LinkGoogleAccountUseCase;
import com.weav.identity.application.usecase.ListOAuthAccountsUseCase;
import com.weav.identity.application.usecase.UnlinkOAuthAccountUseCase;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.domain.exception.ConflictException;
import com.weav.identity.domain.exception.OAuthLastLoginMethodException;
import com.weav.identity.domain.exception.ResourceNotFoundException;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.model.OAuthAccount;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.port.out.OAuthAccountRepository;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.valueobject.OAuthProvider;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.infrastructure.authstate.HmacKeyedFingerprint;
import com.weav.identity.infrastructure.persistence.repository.OAuthAccountRepositoryAdapter;
import com.weav.identity.infrastructure.persistence.repository.SpringDataOAuthAccountRepository;
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
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
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
        OAuthLinkPersistenceIntegrationTest.IntegrationConfiguration.class
})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class OAuthLinkPersistenceIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-09-09T10:15:30Z");
    private static final Instant CREATED_AT = Instant.parse("2026-09-09T09:15:30Z");
    private static final String PASSWORD = "correct-horse-battery-staple";

    @Autowired
    private LinkGoogleAccountUseCase linkUseCase;

    @Autowired
    private ListOAuthAccountsUseCase listUseCase;

    @Autowired
    private UnlinkOAuthAccountUseCase unlinkUseCase;

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
    void matchingAuthoritativeLinkPersistsOneOAuthRowVerifiesLocalEmailAndCreatesNoSession() {
        User user = saveUser("person@gmail.com", passwordHash(PASSWORD), UserStatus.ACTIVE, null);
        UserSession session = saveSession(user.getId(), "link-refresh-1", true);

        LinkGoogleAccountUseCase.LinkBinding binding = linkUseCase.initiate(
                user.getId(), session.getId(), PASSWORD);
        OAuthAccountMetadata result = linkUseCase.complete(
                user.getId(),
                session.getId(),
                handoff(user, session, binding, "google-subject", "PERSON@GMAIL.COM", true, null));

        assertEquals(1, springDataOAuthAccountRepository.count());
        assertEquals(1, springDataUserSessionRepository.count());
        User persisted = userRepository.findById(user.getId()).orElseThrow();
        assertEquals("person@gmail.com", persisted.getEmail());
        assertEquals(NOW, persisted.getEmailVerifiedAt());
        assertEquals("person@gmail.com", result.providerEmail());
        assertEquals(user.getId(), oauthAccountRepository
                .findByProviderAndProviderUserId(OAuthProvider.GOOGLE, "google-subject")
                .orElseThrow().getUserId());
    }

    @Test
    void thirdPartyAndDifferentEmailLinkNeverRewriteOrVerifyLocalEmail() {
        User thirdParty = saveUser("person@example.net", passwordHash(PASSWORD), UserStatus.ACTIVE, null);
        UserSession thirdPartySession = saveSession(thirdParty.getId(), "link-refresh-2", true);
        LinkGoogleAccountUseCase.LinkBinding thirdPartyBinding = linkUseCase.initiate(
                thirdParty.getId(), thirdPartySession.getId(), PASSWORD);
        linkUseCase.complete(
                thirdParty.getId(),
                thirdPartySession.getId(),
                handoff(thirdParty, thirdPartySession, thirdPartyBinding,
                        "third-party-subject", "person@example.net", true, null));

        User different = saveUser("person@example.com", passwordHash(PASSWORD), UserStatus.ACTIVE, null);
        UserSession differentSession = saveSession(different.getId(), "link-refresh-3", true);
        LinkGoogleAccountUseCase.LinkBinding differentBinding = linkUseCase.initiate(
                different.getId(), differentSession.getId(), PASSWORD);
        linkUseCase.complete(
                different.getId(),
                differentSession.getId(),
                handoff(different, differentSession, differentBinding,
                        "different-subject", "other@acme.example", true, "acme.example"));

        User persistedThirdParty = userRepository.findById(thirdParty.getId()).orElseThrow();
        User persistedDifferent = userRepository.findById(different.getId()).orElseThrow();
        assertNull(persistedThirdParty.getEmailVerifiedAt());
        assertNull(persistedDifferent.getEmailVerifiedAt());
        assertEquals("person@example.com", persistedDifferent.getEmail());
        assertEquals(2, springDataOAuthAccountRepository.count());
    }

    @Test
    void callbackAndCompletionRejectRevokedSessionOrChangedCredentialWithoutOAuthMutation() {
        User user = saveUser("person@example.com", passwordHash(PASSWORD), UserStatus.ACTIVE, null);
        UserSession session = saveSession(user.getId(), "link-refresh-4", true);
        LinkGoogleAccountUseCase.LinkBinding binding = linkUseCase.initiate(
                user.getId(), session.getId(), PASSWORD);
        OAuthTransactionStore.Transaction transaction = transaction(user, session, binding);

        updatePassword(user.getId(), passwordHash("replacement-horse-battery-staple"));
        assertThrows(UnauthorizedException.class, () -> linkUseCase.recheckCallback(transaction));
        assertThrows(UnauthorizedException.class, () -> linkUseCase.complete(
                user.getId(), session.getId(),
                handoff(user, session, binding, "revoked-subject", "person@example.com", true, null)));
        assertEquals(0, springDataOAuthAccountRepository.count());

        User second = saveUser("second@example.com", passwordHash(PASSWORD), UserStatus.ACTIVE, null);
        UserSession secondSession = saveSession(second.getId(), "link-refresh-5", true);
        LinkGoogleAccountUseCase.LinkBinding secondBinding = linkUseCase.initiate(
                second.getId(), secondSession.getId(), PASSWORD);
        revokeSession(secondSession.getId());
        assertThrows(UnauthorizedException.class, () -> linkUseCase.complete(
                second.getId(), secondSession.getId(),
                handoff(second, secondSession, secondBinding, "expired-subject", "second@example.com", true, null)));
        assertEquals(0, springDataOAuthAccountRepository.count());
    }

    @Test
    void failedOAuthSaveRollsBackVerificationAndAssociation() {
        User user = saveUser("person@gmail.com", passwordHash(PASSWORD), UserStatus.ACTIVE, null);
        UserSession session = saveSession(user.getId(), "link-refresh-6", true);
        LinkGoogleAccountUseCase.LinkBinding binding = linkUseCase.initiate(
                user.getId(), session.getId(), PASSWORD);
        LinkGoogleAccountUseCase failingUseCase = new LinkGoogleAccountUseCase(
                new CurrentIdentityGuard(userRepository, sessionRepository, Clock.fixed(NOW, ZoneOffset.UTC)),
                userRepository,
                new FailingSaveOAuthAccountRepository(oauthAccountRepository),
                new DeterministicPasswordHasher(),
                new HmacKeyedFingerprint("01234567890123456789012345678901"),
                transactionRunner,
                new AuthInputPolicy(),
                Clock.fixed(NOW, ZoneOffset.UTC));

        assertThrows(IllegalStateException.class, () -> failingUseCase.complete(
                user.getId(), session.getId(),
                handoff(user, session, binding, "rollback-subject", "PERSON@GMAIL.COM", true, null)));

        assertEquals(0, springDataOAuthAccountRepository.count());
        assertNull(userRepository.findById(user.getId()).orElseThrow().getEmailVerifiedAt());
        assertEquals(1, springDataUserSessionRepository.count());
    }

    @Test
    void concurrentSameSubjectAcrossUsersHasOneWinnerAndNoOrphan() throws Exception {
        User first = saveUser("first@example.net", passwordHash(PASSWORD), UserStatus.ACTIVE, null);
        User second = saveUser("second@example.net", passwordHash(PASSWORD), UserStatus.ACTIVE, null);
        UserSession firstSession = saveSession(first.getId(), "link-refresh-7", true);
        UserSession secondSession = saveSession(second.getId(), "link-refresh-8", true);
        LinkGoogleAccountUseCase.LinkBinding firstBinding = linkUseCase.initiate(
                first.getId(), firstSession.getId(), PASSWORD);
        LinkGoogleAccountUseCase.LinkBinding secondBinding = linkUseCase.initiate(
                second.getId(), secondSession.getId(), PASSWORD);
        BlockingOAuthAccountRepository gatedAccounts = new BlockingOAuthAccountRepository(oauthAccountRepository);
        LinkGoogleAccountUseCase concurrentUseCase = new LinkGoogleAccountUseCase(
                new CurrentIdentityGuard(userRepository, sessionRepository, Clock.fixed(NOW, ZoneOffset.UTC)),
                userRepository,
                gatedAccounts,
                new DeterministicPasswordHasher(),
                new HmacKeyedFingerprint("01234567890123456789012345678901"),
                transactionRunner,
                new AuthInputPolicy(),
                Clock.fixed(NOW, ZoneOffset.UTC));

        executor = Executors.newFixedThreadPool(2);
        Future<LinkOutcome> firstResult = executor.submit(() -> complete(
                concurrentUseCase,
                first,
                firstSession,
                firstBinding,
                "same-subject",
                "first@example.net"));
        Future<LinkOutcome> secondResult = executor.submit(() -> complete(
                concurrentUseCase,
                second,
                secondSession,
                secondBinding,
                "same-subject",
                "second@example.net"));

        assertTrue(gatedAccounts.awaitSubjectAbsence(), "both transactions should observe subject absence");
        gatedAccounts.release();

        List<LinkOutcome> outcomes = List.of(
                firstResult.get(20, SECONDS),
                secondResult.get(20, SECONDS));
        assertEquals(1, outcomes.stream().filter(outcome -> outcome.result() != null).count());
        assertEquals(1, outcomes.stream().filter(outcome -> outcome.failure() != null).count());
        assertTrue(outcomes.stream().map(LinkOutcome::failure).filter(java.util.Objects::nonNull)
                .allMatch(failure -> failure instanceof ConflictException));
        assertEquals(1, springDataOAuthAccountRepository.count());
        assertEquals(2, springDataUserRepository.count());
        assertEquals(2, springDataUserSessionRepository.count());
    }

    @Test
    void concurrentDifferentSubjectsForOneUserPreservesSingleGoogleMethod() throws Exception {
        User user = saveUser("single@example.net", passwordHash(PASSWORD), UserStatus.ACTIVE, null);
        UserSession session = saveSession(user.getId(), "link-refresh-9", true);
        LinkGoogleAccountUseCase.LinkBinding binding = linkUseCase.initiate(
                user.getId(), session.getId(), PASSWORD);

        executor = Executors.newFixedThreadPool(2);
        Future<LinkOutcome> first = executor.submit(() -> complete(
                linkUseCase, user, session, binding, "first-subject", "first@example.net"));
        Future<LinkOutcome> second = executor.submit(() -> complete(
                linkUseCase, user, session, binding, "second-subject", "second@example.net"));

        List<LinkOutcome> outcomes = List.of(first.get(20, SECONDS), second.get(20, SECONDS));
        assertEquals(1, outcomes.stream().filter(outcome -> outcome.result() != null).count());
        assertEquals(1, outcomes.stream().filter(outcome -> outcome.failure() != null).count());
        assertTrue(outcomes.stream().map(LinkOutcome::failure).filter(java.util.Objects::nonNull)
                .allMatch(failure -> failure instanceof ConflictException));
        assertEquals(1, springDataOAuthAccountRepository.count());
        assertEquals(1, springDataUserSessionRepository.count());
    }

    @Test
    void listIsSelfScopedAndUnlinkPreservesLocalSession() {
        User user = saveUser("list@example.com", passwordHash(PASSWORD), UserStatus.ACTIVE, null);
        UserSession session = saveSession(user.getId(), "link-refresh-10", true);
        OAuthAccount target = saveAccount(user.getId(), "list-subject", "list@example.com");

        List<OAuthAccountMetadata> metadata = listUseCase.execute(user.getId(), session.getId());
        assertEquals(List.of(target.getId()), metadata.stream().map(OAuthAccountMetadata::id).toList());
        assertEquals("list@example.com", metadata.getFirst().providerEmail());

        assertThrows(UnauthorizedException.class,
                () -> unlinkUseCase.execute(user.getId(), session.getId(), target.getId(), "wrong-password"));
        assertEquals(1, springDataOAuthAccountRepository.count());

        unlinkUseCase.execute(user.getId(), session.getId(), target.getId(), PASSWORD);
        assertEquals(0, springDataOAuthAccountRepository.count());
        assertTrue(sessionRepository.findById(session.getId()).orElseThrow().isActive(NOW));
    }

    @Test
    void unlinkReturnsSafe404ForOtherOwnerAndProtectsOAuthOnlyLastMethod() {
        User owner = saveUser("owner@example.com", passwordHash(PASSWORD), UserStatus.ACTIVE, null);
        User other = saveUser("other-owner@example.com", passwordHash(PASSWORD), UserStatus.ACTIVE, null);
        UserSession ownerSession = saveSession(owner.getId(), "link-refresh-11", true);
        OAuthAccount otherAccount = saveAccount(other.getId(), "other-owner-subject", null);

        assertThrows(ResourceNotFoundException.class,
                () -> unlinkUseCase.execute(owner.getId(), ownerSession.getId(), otherAccount.getId(), PASSWORD));
        assertTrue(oauthAccountRepository.findById(otherAccount.getId()).isPresent());

        User oauthOnly = saveUser("oauth-only@example.com", null, UserStatus.ACTIVE, null);
        UserSession oauthOnlySession = saveSession(oauthOnly.getId(), "link-refresh-12", true);
        OAuthAccount oauthOnlyAccount = saveAccount(oauthOnly.getId(), "oauth-only-subject", null);

        OAuthLastLoginMethodException failure = assertThrows(
                OAuthLastLoginMethodException.class,
                () -> unlinkUseCase.execute(
                        oauthOnly.getId(), oauthOnlySession.getId(), oauthOnlyAccount.getId(), null));
        assertEquals("OAUTH_LAST_LOGIN_METHOD", failure.getCode());
        assertTrue(oauthAccountRepository.findById(oauthOnlyAccount.getId()).isPresent());
    }

    private LinkOutcome complete(
            LinkGoogleAccountUseCase useCase,
            User user,
            UserSession session,
            LinkGoogleAccountUseCase.LinkBinding binding,
            String subject,
            String email) {
        try {
            return new LinkOutcome(
                    useCase.complete(
                            user.getId(),
                            session.getId(),
                            handoff(user, session, binding, subject, email, true, null)),
                    null);
        } catch (Throwable failure) {
            return new LinkOutcome(null, failure);
        }
    }

    private User saveUser(String email, String passwordHash, UserStatus status, Instant verifiedAt) {
        return userRepository.save(new User(
                UUID.randomUUID(),
                email,
                passwordHash,
                "Identity Test",
                null,
                SystemRole.USER,
                status,
                CREATED_AT,
                CREATED_AT,
                verifiedAt));
    }

    private UserSession saveSession(UUID userId, String refreshHash, boolean active) {
        return sessionRepository.save(new UserSession(
                UUID.randomUUID(),
                userId,
                refreshHash,
                "JUnit",
                "127.0.0.1",
                active ? NOW.plus(Duration.ofHours(1)) : NOW.minusSeconds(1),
                CREATED_AT));
    }

    private OAuthAccount saveAccount(UUID userId, String subject, String providerEmail) {
        return oauthAccountRepository.save(new OAuthAccount(
                UUID.randomUUID(),
                userId,
                OAuthProvider.GOOGLE,
                subject,
                providerEmail,
                CREATED_AT,
                CREATED_AT));
    }

    private void updatePassword(UUID userId, String replacementHash) {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            User locked = userRepository.findByIdForUpdate(userId).orElseThrow();
            locked.changePassword(replacementHash, NOW);
            userRepository.save(locked);
        });
    }

    private void revokeSession(UUID sessionId) {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            UserSession locked = sessionRepository.findByIdForUpdate(sessionId).orElseThrow();
            locked.revoke(NOW);
            sessionRepository.save(locked);
        });
    }

    private static OAuthTransactionStore.Transaction transaction(
            User user,
            UserSession session,
            LinkGoogleAccountUseCase.LinkBinding binding) {
        return new OAuthTransactionStore.Transaction(
                "t".repeat(43),
                OAuthTransactionStore.Intent.LINK,
                "web",
                "web",
                "s".repeat(43),
                "n".repeat(43),
                new OAuthSecret("provider-verifier"),
                "c".repeat(43),
                user.getId(),
                session.getId(),
                binding.credentialFingerprint(),
                Duration.ofMinutes(10));
    }

    private static OAuthTransactionStore.Handoff handoff(
            User user,
            UserSession session,
            LinkGoogleAccountUseCase.LinkBinding binding,
            String subject,
            String email,
            boolean emailVerified,
            String hostedDomain) {
        return new OAuthTransactionStore.Handoff(
                "h".repeat(43),
                "t".repeat(43),
                OAuthTransactionStore.Intent.LINK,
                "web",
                "web",
                "c".repeat(43),
                new OAuthProviderClient.ProviderIdentity(
                        OAuthProvider.GOOGLE,
                        subject,
                        email,
                        emailVerified,
                        hostedDomain,
                        NOW),
                user.getId(),
                session.getId(),
                binding.credentialFingerprint(),
                Duration.ofSeconds(60),
                5);
    }

    private static String passwordHash(String password) {
        return "hash:" + password;
    }

    private record LinkOutcome(OAuthAccountMetadata result, Throwable failure) {
    }

    private static final class DeterministicPasswordHasher implements PasswordHasher {
        @Override
        public String hash(String rawPassword) {
            return passwordHash(rawPassword);
        }

        @Override
        public boolean matches(String rawPassword, String encodedPassword) {
            return passwordHash(rawPassword).equals(encodedPassword);
        }
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

    private static final class BlockingOAuthAccountRepository implements OAuthAccountRepository {
        private final OAuthAccountRepository delegate;
        private final CountDownLatch subjectAbsence = new CountDownLatch(2);
        private final CountDownLatch proceed = new CountDownLatch(1);

        private BlockingOAuthAccountRepository(OAuthAccountRepository delegate) {
            this.delegate = delegate;
        }

        boolean awaitSubjectAbsence() throws InterruptedException {
            return subjectAbsence.await(10, SECONDS);
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
            if (result.isEmpty()) {
                subjectAbsence.countDown();
                try {
                    if (!proceed.await(10, SECONDS)) {
                        throw new IllegalStateException("timed out waiting for subject race release");
                    }
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("interrupted while waiting for subject race release", exception);
                }
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
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class IntegrationConfiguration {

        @Bean
        Clock testClock() {
            return Clock.fixed(NOW, ZoneOffset.UTC);
        }

        @Bean
        PasswordHasher passwordHasher() {
            return new DeterministicPasswordHasher();
        }

        @Bean
        KeyedFingerprint keyedFingerprint() {
            return new HmacKeyedFingerprint("01234567890123456789012345678901");
        }

        @Bean
        TransactionRunner transactionRunner(PlatformTransactionManager transactionManager) {
            return new SpringTransactionRunner(new TransactionTemplate(transactionManager));
        }

        @Bean
        CurrentIdentityGuard currentIdentityGuard(
                UserRepository userRepository,
                com.weav.identity.domain.port.out.UserSessionRepository sessionRepository,
                Clock clock) {
            return new CurrentIdentityGuard(userRepository, sessionRepository, clock);
        }

        @Bean
        LinkGoogleAccountUseCase linkGoogleAccountUseCase(
                CurrentIdentityGuard identityGuard,
                UserRepository userRepository,
                OAuthAccountRepository oauthAccountRepository,
                PasswordHasher passwordHasher,
                KeyedFingerprint fingerprint,
                TransactionRunner transactionRunner,
                Clock clock) {
            return new LinkGoogleAccountUseCase(
                    identityGuard,
                    userRepository,
                    oauthAccountRepository,
                    passwordHasher,
                    fingerprint,
                    transactionRunner,
                    new AuthInputPolicy(),
                    clock);
        }

        @Bean
        ListOAuthAccountsUseCase listOAuthAccountsUseCase(
                CurrentIdentityGuard identityGuard,
                OAuthAccountRepository oauthAccountRepository) {
            return new ListOAuthAccountsUseCase(identityGuard, oauthAccountRepository);
        }

        @Bean
        UnlinkOAuthAccountUseCase unlinkOAuthAccountUseCase(
                CurrentIdentityGuard identityGuard,
                UserRepository userRepository,
                OAuthAccountRepository oauthAccountRepository,
                PasswordHasher passwordHasher,
                TransactionRunner transactionRunner) {
            return new UnlinkOAuthAccountUseCase(
                    identityGuard,
                    userRepository,
                    oauthAccountRepository,
                    passwordHasher,
                    transactionRunner,
                    new AuthInputPolicy());
        }
    }
}
