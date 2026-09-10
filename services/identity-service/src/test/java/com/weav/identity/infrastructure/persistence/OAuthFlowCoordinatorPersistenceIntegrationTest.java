package com.weav.identity.infrastructure.persistence;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.dto.OAuthCallbackCommand;
import com.weav.identity.application.dto.OAuthCallbackResult;
import com.weav.identity.application.dto.OAuthClientRegistration;
import com.weav.identity.application.dto.OAuthConfiguration;
import com.weav.identity.application.dto.OAuthExchangeCommand;
import com.weav.identity.application.dto.OAuthExchangeResult;
import com.weav.identity.application.dto.OAuthSecret;
import com.weav.identity.application.dto.OAuthStartCommand;
import com.weav.identity.application.dto.OAuthStartResult;
import com.weav.identity.application.port.out.AccessTokenIssuer;
import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OAuthProviderClient;
import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.RefreshTokenGenerator;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.application.usecase.CompleteGoogleLoginUseCase;
import com.weav.identity.application.usecase.LinkGoogleAccountUseCase;
import com.weav.identity.application.usecase.OAuthFlowCoordinator;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.application.validation.OAuthProtocolPolicy;
import com.weav.identity.domain.exception.OAuthHandoffInvalidException;
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
import com.weav.identity.infrastructure.authstate.ValkeyOAuthTransactionStore;
import com.weav.identity.infrastructure.persistence.repository.OAuthAccountRepositoryAdapter;
import com.weav.identity.infrastructure.persistence.repository.SpringDataOAuthAccountRepository;
import com.weav.identity.infrastructure.persistence.repository.SpringDataUserRepository;
import com.weav.identity.infrastructure.persistence.repository.SpringDataUserSessionRepository;
import com.weav.identity.infrastructure.persistence.repository.UserRepositoryAdapter;
import com.weav.identity.infrastructure.persistence.repository.UserSessionRepositoryAdapter;
import com.weav.identity.infrastructure.persistence.SpringTransactionRunner;
import com.weav.identity.infrastructure.security.SecureRefreshTokenGenerator;
import com.weav.identity.infrastructure.security.oauth.GoogleOidcAdapter;
import com.weav.identity.infrastructure.security.oauth.SignedGoogleProviderFixture;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Coordinator proof with the real Valkey atomic state store and PostgreSQL
 * account/session persistence. Provider protocol signature validation remains
 * covered by the signed local Google adapter fixture; this test focuses on
 * the cross-boundary ordering and one-use handoff/account mutation.
 */
@Testcontainers
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({
        TestcontainersConfiguration.class,
        UserRepositoryAdapter.class,
        OAuthAccountRepositoryAdapter.class,
        UserSessionRepositoryAdapter.class,
        OAuthFlowCoordinatorPersistenceIntegrationTest.IntegrationConfiguration.class
})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class OAuthFlowCoordinatorPersistenceIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-09-10T00:00:00Z");
    private static final String PASSWORD = "correct-horse-battery-staple";
    private static final String HMAC_SECRET = "01234567890123456789012345678901";
    private static final String VERIFIER = "client-verifier-012345678901234567890123456789012";
    private static final URI CALLBACK = URI.create("http://identity.test/auth/oauth/google/callback");
    private static final URI RETURN_TARGET = URI.create("http://web.test/auth/callback");
    private static final AtomicBoolean FAIL_ACCESS_TOKEN_ISSUE = new AtomicBoolean();

    @Container
    private static final GenericContainer<?> VALKEY = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine")).withExposedPorts(6379);

    @Autowired
    private StringRedisTemplate redis;

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
    private CompleteGoogleLoginUseCase loginUseCase;

    @Autowired
    private LinkGoogleAccountUseCase linkUseCase;

    @Autowired
    private KeyedFingerprint fingerprint;

    private StubProvider provider;
    private SignedGoogleProviderFixture signedFixture;
    private OAuthFlowCoordinator coordinator;

    @BeforeEach
    void cleanFixtures() {
        redis.getConnectionFactory().getConnection().serverCommands().flushDb();
        springDataUserSessionRepository.deleteAll();
        springDataOAuthAccountRepository.deleteAll();
        springDataUserRepository.deleteAll();
        provider = new StubProvider();
        signedFixture = SignedGoogleProviderFixture.start();
        FAIL_ACCESS_TOKEN_ISSUE.set(false);
        OAuthConfiguration configuration = configuration();
        coordinator = coordinator(configuration, provider);
    }

    @AfterEach
    void clearRedis() {
        if (redis != null) {
            redis.getConnectionFactory().getConnection().serverCommands().flushDb();
        }
        if (signedFixture != null) {
            signedFixture.close();
        }
        FAIL_ACCESS_TOKEN_ISSUE.set(false);
    }

    @Test
    void loginStartCallbackExchangeUsesValkeyOnceAndPostgresNormalSessionRules() {
        provider.identity = identity("login-subject", "person@gmail.com", true, null);

        OAuthStartResult start = coordinator.startLogin(startCommand());
        OAuthCallbackResult callback = coordinator.callback(OAuthCallbackCommand.withAuthorizationCode(
                start.transactionId(), provider.state(), new OAuthSecret("provider-code")));
        OAuthExchangeResult result = coordinator.exchangeLogin(exchangeCommand(
                start.transactionId(), callback.handoffCode()));

        assertEquals(OAuthExchangeResult.Outcome.LOGIN, result.outcome());
        assertEquals(1, springDataUserRepository.count());
        assertEquals(1, springDataOAuthAccountRepository.count());
        assertEquals(1, springDataUserSessionRepository.count());
        assertEquals("person@gmail.com", userRepository.findByEmail("person@gmail.com").orElseThrow().getEmail());
        assertTrue(callback.status() == OAuthCallbackResult.Status.COMPLETED);
    }

    @Test
    void linkStartCallbackExchangeUsesCurrentSessionAndDoesNotMintAnotherSession() {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        userRepository.save(new User(
                userId,
                "local@gmail.com",
                "hash:" + PASSWORD,
                null,
                null,
                SystemRole.USER,
                UserStatus.ACTIVE,
                NOW,
                NOW));
        sessionRepository.save(new UserSession(
                sessionId,
                userId,
                "refresh-hash",
                "test-agent",
                "127.0.0.1",
                NOW.plus(Duration.ofDays(7)),
                NOW));
        provider.identity = identity("link-subject", "LOCAL@GMAIL.COM", true, null);

        OAuthStartResult start = coordinator.startLink(userId, sessionId, PASSWORD, startCommand());
        OAuthCallbackResult callback = coordinator.callback(OAuthCallbackCommand.withAuthorizationCode(
                start.transactionId(), provider.state(), new OAuthSecret("provider-code")));
        OAuthExchangeResult result = coordinator.exchangeLink(
                userId,
                sessionId,
                exchangeCommand(start.transactionId(), callback.handoffCode()));

        assertEquals(OAuthExchangeResult.Outcome.LINKED, result.outcome());
        assertEquals(1, springDataUserRepository.count());
        assertEquals(1, springDataOAuthAccountRepository.count());
        assertEquals(1, springDataUserSessionRepository.count());
        OAuthAccount account = oauthAccountRepository.findByProviderAndProviderUserId(
                OAuthProvider.GOOGLE, "link-subject").orElseThrow();
        assertEquals(userId, account.getUserId());
        assertEquals(userId, sessionRepository.findById(sessionId).orElseThrow().getUserId());
        assertFalse(result.toString().contains("refresh-hash"));
    }

    @Test
    void consumedHandoffCannotBeReplayedAfterSuccessfulPostgresMutation() {
        provider.identity = identity("replay-subject", "replay@gmail.com", true, null);

        OAuthStartResult start = coordinator.startLogin(startCommand());
        OAuthCallbackResult callback = coordinator.callback(OAuthCallbackCommand.withAuthorizationCode(
                start.transactionId(), provider.state(), new OAuthSecret("provider-code")));
        OAuthExchangeCommand command = exchangeCommand(start.transactionId(), callback.handoffCode());
        coordinator.exchangeLogin(command);

        var replay = org.junit.jupiter.api.Assertions.assertThrows(
                com.weav.identity.domain.exception.OAuthHandoffInvalidException.class,
                () -> coordinator.exchangeLogin(command));
        assertEquals("OAUTH_HANDOFF_INVALID", replay.getCode());
        assertEquals(1, springDataUserRepository.count());
        assertEquals(1, springDataOAuthAccountRepository.count());
        assertEquals(1, springDataUserSessionRepository.count());
    }

    @Test
    void wrongStateOrCorrelationCookieDoesNotCallProviderOrCreateHandoff() {
        provider.identity = identity("wrong-binding-subject", "wrong-binding@gmail.com", true, null);

        OAuthStartResult start = coordinator.startLogin(startCommand());
        OAuthCallbackResult wrongState = coordinator.callback(OAuthCallbackCommand.withAuthorizationCode(
                start.transactionId(), new OAuthSecret("B".repeat(43)), new OAuthSecret("provider-code")));
        OAuthCallbackResult wrongCookie = coordinator.callback(OAuthCallbackCommand.withAuthorizationCode(
                "C".repeat(43), provider.state(), new OAuthSecret("provider-code")));

        assertEquals(OAuthCallbackResult.Status.INVALID, wrongState.status());
        assertEquals(OAuthCallbackResult.Status.INVALID, wrongCookie.status());
        assertEquals(0, provider.exchangeCalls);
        assertTrue(redis.keys("oauth:tx:*").size() == 1);
        assertTrue(redis.keys("oauth:handoff:*").isEmpty());
    }

    @Test
    void validCancellationConsumesStateAndCallbackReplayCannotCreateHandoff() {
        provider.identity = identity("cancelled-subject", "cancelled@gmail.com", true, null);

        OAuthStartResult start = coordinator.startLogin(startCommand());
        OAuthCallbackResult cancelled = coordinator.callback(OAuthCallbackCommand.cancelled(
                start.transactionId(), provider.state()));
        OAuthCallbackResult replay = coordinator.callback(OAuthCallbackCommand.withAuthorizationCode(
                start.transactionId(), provider.state(), new OAuthSecret("provider-code")));

        assertEquals(OAuthCallbackResult.Status.CANCELLED, cancelled.status());
        assertEquals(OAuthCallbackResult.Status.INVALID, replay.status());
        assertEquals(0, provider.exchangeCalls);
        assertTrue(redis.keys("oauth:tx:*").isEmpty());
        assertTrue(redis.keys("oauth:handoff:*").isEmpty());
    }

    @Test
    void wrongVerifierLeavesHandoffForOneCorrectProof() {
        provider.identity = identity("proof-subject", "proof@gmail.com", true, null);

        OAuthStartResult start = coordinator.startLogin(startCommand());
        OAuthCallbackResult callback = coordinator.callback(OAuthCallbackCommand.withAuthorizationCode(
                start.transactionId(), provider.state(), new OAuthSecret("provider-code")));
        OAuthExchangeCommand wrongProof = exchangeCommand(
                start.transactionId(), callback.handoffCode(), "D".repeat(43));

        assertThrows(OAuthHandoffInvalidException.class, () -> coordinator.exchangeLogin(wrongProof));
        assertEquals(0, springDataUserRepository.count());
        assertEquals(0, springDataOAuthAccountRepository.count());
        assertEquals(0, springDataUserSessionRepository.count());

        OAuthExchangeResult result = coordinator.exchangeLogin(
                exchangeCommand(start.transactionId(), callback.handoffCode(), VERIFIER));
        assertEquals(OAuthExchangeResult.Outcome.LOGIN, result.outcome());
        assertEquals(1, springDataUserRepository.count());
        assertEquals(1, springDataOAuthAccountRepository.count());
        assertEquals(1, springDataUserSessionRepository.count());
    }

    @Test
    void credentialChangeBetweenLinkCallbackAndExchangePreventsLinkMutation() {
        LocalAccount local = seedLocalAccount();
        provider.identity = identity("credential-change-subject", "provider@gmail.com", true, null);

        OAuthStartResult start = coordinator.startLink(local.userId(), local.sessionId(), PASSWORD, startCommand());
        OAuthCallbackResult callback = coordinator.callback(OAuthCallbackCommand.withAuthorizationCode(
                start.transactionId(), provider.state(), new OAuthSecret("provider-code")));

        User changed = userRepository.findById(local.userId()).orElseThrow();
        changed.changePassword("hash:changed-password", NOW.plusSeconds(1));
        userRepository.save(changed);

        assertThrows(UnauthorizedException.class, () -> coordinator.exchangeLink(
                local.userId(), local.sessionId(), exchangeCommand(start.transactionId(), callback.handoffCode())));
        assertEquals(0, springDataOAuthAccountRepository.count());
        assertEquals(1, springDataUserSessionRepository.count());
    }

    @Test
    void revokedSessionBetweenLinkCallbackAndExchangePreventsLinkMutation() {
        LocalAccount local = seedLocalAccount();
        provider.identity = identity("revoked-session-subject", "provider@gmail.com", true, null);

        OAuthStartResult start = coordinator.startLink(local.userId(), local.sessionId(), PASSWORD, startCommand());
        OAuthCallbackResult callback = coordinator.callback(OAuthCallbackCommand.withAuthorizationCode(
                start.transactionId(), provider.state(), new OAuthSecret("provider-code")));

        UserSession revoked = sessionRepository.findById(local.sessionId()).orElseThrow();
        revoked.revoke(NOW);
        sessionRepository.save(revoked);

        assertThrows(UnauthorizedException.class, () -> coordinator.exchangeLink(
                local.userId(), local.sessionId(), exchangeCommand(start.transactionId(), callback.handoffCode())));
        assertEquals(0, springDataOAuthAccountRepository.count());
        assertTrue(sessionRepository.findById(local.sessionId()).orElseThrow().getRevokedAt() != null);
    }

    @Test
    void accountMutationFailureRollsBackPostgresAndConsumedHandoffCannotReplay() {
        provider.identity = identity("mutation-failure-subject", "mutation-failure@gmail.com", true, null);

        OAuthStartResult start = coordinator.startLogin(startCommand());
        OAuthCallbackResult callback = coordinator.callback(OAuthCallbackCommand.withAuthorizationCode(
                start.transactionId(), provider.state(), new OAuthSecret("provider-code")));
        OAuthExchangeCommand command = exchangeCommand(start.transactionId(), callback.handoffCode());
        FAIL_ACCESS_TOKEN_ISSUE.set(true);

        assertThrows(IllegalStateException.class, () -> coordinator.exchangeLogin(command));
        assertEquals(0, springDataUserRepository.count());
        assertEquals(0, springDataOAuthAccountRepository.count());
        assertEquals(0, springDataUserSessionRepository.count());
        assertTrue(redis.keys("oauth:handoff:*").isEmpty());

        FAIL_ACCESS_TOKEN_ISSUE.set(false);
        assertThrows(OAuthHandoffInvalidException.class, () -> coordinator.exchangeLogin(command));
        assertEquals(0, springDataUserRepository.count());
        assertEquals(0, springDataOAuthAccountRepository.count());
        assertEquals(0, springDataUserSessionRepository.count());
    }

    @Test
    void signedGoogleAdapterComposesWithValkeyAndPostgresBeforeAndAfterExchange() {
        OAuthConfiguration signedConfiguration = configuration(signedFixture.registration());
        GoogleOidcAdapter signedAdapter = signedFixture.adapter(
                signedConfiguration, fingerprint, Clock.fixed(NOW, ZoneOffset.UTC));
        OAuthFlowCoordinator signedCoordinator = coordinator(signedConfiguration, signedAdapter);

        OAuthStartResult start = signedCoordinator.startLogin(startCommand());
        Map<String, String> providerQuery = query(start.authorizationUrl());
        signedFixture.setIdentity(providerQuery.get("nonce"), "signed-composed-subject",
                "signed-composed@gmail.com", true);
        OAuthCallbackResult callback = signedCoordinator.callback(OAuthCallbackCommand.withAuthorizationCode(
                start.transactionId(), new OAuthSecret(providerQuery.get("state")),
                new OAuthSecret("signed-provider-code")));

        assertEquals(OAuthCallbackResult.Status.COMPLETED, callback.status());
        assertEquals(0, springDataUserRepository.count());
        assertEquals(0, springDataOAuthAccountRepository.count());
        assertEquals(0, springDataUserSessionRepository.count());
        Set<String> handoffKeys = redis.keys("oauth:handoff:*");
        assertEquals(1, handoffKeys.size());
        Map<Object, Object> storedHandoff = redis.opsForHash().entries(handoffKeys.iterator().next());
        assertFalse(storedHandoff.toString().contains("provider-access-token"));

        OAuthExchangeResult result = signedCoordinator.exchangeLogin(
                exchangeCommand(start.transactionId(), callback.handoffCode()));

        assertEquals(OAuthExchangeResult.Outcome.LOGIN, result.outcome());
        assertEquals(1, springDataUserRepository.count());
        assertEquals(1, springDataOAuthAccountRepository.count());
        assertEquals(1, springDataUserSessionRepository.count());
        assertEquals(1, signedFixture.tokenHits());
        assertTrue(signedFixture.jwksHits() >= 1);
    }

    @Test
    void signedGoogleNonceMismatchConsumesCallbackWithoutHandoffOrAccountMutation() {
        OAuthConfiguration signedConfiguration = configuration(signedFixture.registration());
        GoogleOidcAdapter signedAdapter = signedFixture.adapter(
                signedConfiguration, fingerprint, Clock.fixed(NOW, ZoneOffset.UTC));
        OAuthFlowCoordinator signedCoordinator = coordinator(signedConfiguration, signedAdapter);

        OAuthStartResult start = signedCoordinator.startLogin(startCommand());
        Map<String, String> providerQuery = query(start.authorizationUrl());
        signedFixture.setIdentity("wrong-nonce", "signed-nonce-mismatch-subject",
                "signed-nonce-mismatch@gmail.com", true);
        OAuthCallbackResult callback = signedCoordinator.callback(OAuthCallbackCommand.withAuthorizationCode(
                start.transactionId(), new OAuthSecret(providerQuery.get("state")),
                new OAuthSecret("signed-provider-code")));

        assertEquals(OAuthCallbackResult.Status.PROVIDER_UNAVAILABLE, callback.status());
        assertTrue(redis.keys("oauth:tx:*").isEmpty());
        assertTrue(redis.keys("oauth:handoff:*").isEmpty());
        assertEquals(0, springDataUserRepository.count());
        assertEquals(0, springDataOAuthAccountRepository.count());
        assertEquals(0, springDataUserSessionRepository.count());
        assertEquals(1, signedFixture.tokenHits());
    }

    @Test
    void explicitLoginEntryPointDoesNotFallBackToLinkForAValidLoginHandoff() {
        provider.identity = identity("explicit-login-subject", "explicit-login@gmail.com", true, null);

        OAuthStartResult start = coordinator.startLogin(startCommand());
        OAuthCallbackResult callback = coordinator.callback(OAuthCallbackCommand.withAuthorizationCode(
                start.transactionId(), provider.state(), new OAuthSecret("provider-code")));
        OAuthExchangeCommand command = exchangeCommand(start.transactionId(), callback.handoffCode());

        assertThrows(OAuthHandoffInvalidException.class, () -> coordinator.exchangeLink(
                UUID.randomUUID(), UUID.randomUUID(), command));
        assertEquals(0, springDataUserRepository.count());
        OAuthExchangeResult result = coordinator.exchangeLogin(command);
        assertEquals(OAuthExchangeResult.Outcome.LOGIN, result.outcome());
        assertEquals(1, springDataUserRepository.count());
        assertEquals(1, springDataOAuthAccountRepository.count());
        assertEquals(1, springDataUserSessionRepository.count());
    }

    private OAuthExchangeCommand exchangeCommand(String transactionId, OAuthSecret handoffCode) {
        return exchangeCommand(transactionId, handoffCode, VERIFIER);
    }

    private OAuthExchangeCommand exchangeCommand(
            String transactionId,
            OAuthSecret handoffCode,
            String verifier
    ) {
        return new OAuthExchangeCommand(
                "web", "web", transactionId, handoffCode, new OAuthSecret(verifier));
    }

    private OAuthStartCommand startCommand() {
        return new OAuthStartCommand(
                "web", "web",
                OAuthProtocolPolicy.challengeForVerifier(VERIFIER),
                OAuthProtocolPolicy.S256);
    }

    private OAuthConfiguration configuration() {
        OAuthClientRegistration registration = new OAuthClientRegistration(
                "web", "web", OAuthProvider.GOOGLE, "google-client", CALLBACK, RETURN_TARGET,
                Set.of("http://web.test"));
        return configuration(registration);
    }

    private OAuthConfiguration configuration(OAuthClientRegistration registration) {
        return OAuthConfiguration.enabled(
                registration,
                OAuthConfiguration.GOOGLE_ISSUER_URI,
                new OAuthSecret("provider-secret"),
                Duration.ofMinutes(10),
                Duration.ofSeconds(60),
                Duration.ofMinutes(10),
                Duration.ofSeconds(5),
                5,
                OAuthConfiguration.CookiePolicy.defaults(),
                Set.of());
    }

    private OAuthFlowCoordinator coordinator(
            OAuthConfiguration configuration,
            OAuthProviderClient providerClient
    ) {
        return new OAuthFlowCoordinator(
                configuration,
                providerClient,
                new ValkeyOAuthTransactionStore(redis, configuration),
                fingerprint,
                new SecureRandom(),
                linkUseCase,
                loginUseCase);
    }

    private LocalAccount seedLocalAccount() {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        userRepository.save(new User(
                userId,
                "local-" + userId + "@example.com",
                "hash:" + PASSWORD,
                null,
                null,
                SystemRole.USER,
                UserStatus.ACTIVE,
                NOW,
                NOW));
        sessionRepository.save(new UserSession(
                sessionId,
                userId,
                "refresh-hash-" + sessionId,
                "test-agent",
                "127.0.0.1",
                NOW.plus(Duration.ofDays(7)),
                NOW));
        return new LocalAccount(userId, sessionId);
    }

    private static Map<String, String> query(URI uri) {
        Map<String, String> result = new LinkedHashMap<>();
        for (String pair : uri.getRawQuery().split("&")) {
            String[] parts = pair.split("=", 2);
            result.put(
                    URLDecoder.decode(parts[0], StandardCharsets.UTF_8),
                    URLDecoder.decode(parts.length == 1 ? "" : parts[1], StandardCharsets.UTF_8));
        }
        return result;
    }

    private record LocalAccount(UUID userId, UUID sessionId) {
    }

    private static OAuthProviderClient.ProviderIdentity identity(
            String subject, String email, boolean verified, String hostedDomain) {
        return new OAuthProviderClient.ProviderIdentity(
                OAuthProvider.GOOGLE, subject, email, verified, hostedDomain, NOW);
    }

    static final class StubProvider implements OAuthProviderClient {
        private AuthorizationRequest authorizationRequest;
        private ProviderIdentity identity;
        private int exchangeCalls;

        @Override
        public AuthorizationUrl buildAuthorizationUrl(AuthorizationRequest request) {
            authorizationRequest = request;
            return new AuthorizationUrl(URI.create(
                    "https://accounts.google.com/o/oauth2/v2/auth?state=" + request.state().value()));
        }

        @Override
        public ProviderIdentity exchangeAuthorizationCode(AuthorizationCodeRequest request) {
            assertNotNull(authorizationRequest);
            exchangeCalls++;
            return identity;
        }

        OAuthSecret state() {
            assertNotNull(authorizationRequest);
            return authorizationRequest.state();
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
            return new HmacKeyedFingerprint(HMAC_SECRET);
        }

        @Bean
        TransactionRunner transactionRunner(PlatformTransactionManager transactionManager) {
            return new SpringTransactionRunner(new TransactionTemplate(transactionManager));
        }

        @Bean
        RefreshTokenGenerator refreshTokenGenerator() {
            return new SecureRefreshTokenGenerator(new SecureRandom());
        }

        @Bean
        AccessTokenIssuer accessTokenIssuer(
                Clock clock,
                SpringDataUserSessionRepository sessionJpaRepository
        ) {
            return (userId, sessionId, systemRole, userStatus) -> {
                if (FAIL_ACCESS_TOKEN_ISSUE.get()) {
                    if (!sessionJpaRepository.existsById(sessionId)) {
                        throw new AssertionError("access-token failure must run after session persistence");
                    }
                    throw new IllegalStateException("injected access-token issuance failure");
                }
                return new com.weav.identity.application.dto.IssuedAccessToken(
                        "access-" + sessionId, clock.instant().plus(Duration.ofMinutes(15)));
            };
        }

        @Bean
        CurrentIdentityGuard currentIdentityGuard(
                UserRepository userRepository,
                com.weav.identity.domain.port.out.UserSessionRepository sessionRepository,
                Clock clock) {
            return new CurrentIdentityGuard(userRepository, sessionRepository, clock);
        }

        @Bean
        CompleteGoogleLoginUseCase completeGoogleLoginUseCase(
                UserRepository userRepository,
                OAuthAccountRepository oauthAccountRepository,
                com.weav.identity.domain.port.out.UserSessionRepository sessionRepository,
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
                    Duration.ofDays(7));
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
        LettuceConnectionFactory redisConnectionFactory() {
            RedisStandaloneConfiguration redis = new RedisStandaloneConfiguration(
                    VALKEY.getHost(), VALKEY.getMappedPort(6379));
            return new LettuceConnectionFactory(redis);
        }

        @Bean
        StringRedisTemplate stringRedisTemplate(LettuceConnectionFactory factory) {
            return new StringRedisTemplate(factory);
        }
    }

    private static final class DeterministicPasswordHasher implements PasswordHasher {
        @Override
        public String hash(String rawPassword) {
            return "hash:" + rawPassword;
        }

        @Override
        public boolean matches(String rawPassword, String encodedPassword) {
            return hash(rawPassword).equals(encodedPassword);
        }
    }
}
