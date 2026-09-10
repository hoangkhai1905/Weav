package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.GeneratedRefreshToken;
import com.weav.identity.application.dto.IssuedAccessToken;
import com.weav.identity.application.dto.TokenPairResult;
import com.weav.identity.application.port.out.AccessTokenIssuer;
import com.weav.identity.application.port.out.OAuthProviderClient;
import com.weav.identity.application.port.out.OAuthTransactionStore;
import com.weav.identity.application.port.out.RefreshTokenGenerator;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.domain.exception.BadRequestException;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.Optional;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CompleteGoogleLoginUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-09-09T10:15:30Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    private static final Duration SESSION_LIFETIME = Duration.ofDays(7);
    private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");

    private final UserRepository userRepository = mock(UserRepository.class);
    private final OAuthAccountRepository oauthAccountRepository = mock(OAuthAccountRepository.class);
    private final UserSessionRepository sessionRepository = mock(UserSessionRepository.class);
    private final RefreshTokenGenerator refreshTokenGenerator = mock(RefreshTokenGenerator.class);
    private final AccessTokenIssuer accessTokenIssuer = mock(AccessTokenIssuer.class);
    private final RecordingTransactionRunner transactionRunner = new RecordingTransactionRunner();
    private final CompleteGoogleLoginUseCase useCase = new CompleteGoogleLoginUseCase(
            userRepository,
            oauthAccountRepository,
            sessionRepository,
            refreshTokenGenerator,
            accessTokenIssuer,
            transactionRunner,
            new AuthInputPolicy(),
            CLOCK,
            SESSION_LIFETIME
    );

    @BeforeEach
    void stubNormalSessionIssuance() {
        when(refreshTokenGenerator.generate())
                .thenReturn(new GeneratedRefreshToken("refresh-value", "refresh-hash"));
        when(sessionRepository.save(any(UserSession.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(accessTokenIssuer.issue(eq(USER_ID), any(UUID.class), eq(SystemRole.USER), eq(UserStatus.ACTIVE)))
                .thenReturn(new IssuedAccessToken("access-value", NOW.plus(Duration.ofMinutes(15))));
    }

    @Test
    void linkedActiveSubjectCreatesOneSessionWithoutOverwritingLocalEmailOrVerification() {
        User user = user("local@example.com", "local-verified-hash", UserStatus.ACTIVE, NOW.minusSeconds(5));
        OAuthAccount linked = account(user.getId(), "Google-Subject", "provider@other.example");
        OAuthProviderClient.ProviderIdentity identity = identity("Google-Subject", null, false, null);
        when(oauthAccountRepository.findByProviderAndProviderUserId(OAuthProvider.GOOGLE, "Google-Subject"))
                .thenReturn(Optional.of(linked), Optional.of(linked));
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));

        TokenPairResult result = useCase.execute(loginHandoff(identity), "JUnit", "127.0.0.1");

        assertEquals("access-value", result.accessToken());
        assertEquals("refresh-value", result.refreshToken());
        assertEquals(NOW.plus(SESSION_LIFETIME), result.refreshExpiresAt());
        assertEquals("local@example.com", result.user().email());
        assertEquals(NOW.minusSeconds(5), result.user().emailVerifiedAt());
        verify(oauthAccountRepository, never()).save(any(OAuthAccount.class));
        verify(sessionRepository).save(any(UserSession.class));
        assertEquals(1, transactionRunner.invocations);
    }

    @Test
    void linkedDisabledSubjectFailsBeforeSessionIssuance() {
        User user = user("disabled@example.com", "local-hash", UserStatus.DISABLED, null);
        OAuthAccount linked = account(user.getId(), "disabled-subject", "disabled@example.com");
        when(oauthAccountRepository.findByProviderAndProviderUserId(OAuthProvider.GOOGLE, "disabled-subject"))
                .thenReturn(Optional.of(linked), Optional.of(linked));
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));

        assertUnauthorized(() -> useCase.execute(loginHandoff(
                identity("disabled-subject", null, false, null))));

        verify(refreshTokenGenerator, never()).generate();
        verify(sessionRepository, never()).save(any(UserSession.class));
        verify(accessTokenIssuer, never()).issue(any(), any(), any(), any());
    }

    @Test
    void newAuthoritativeGmailIdentityCreatesOAuthOnlyUserAndOneSession() {
        User saved = user("new.user@gmail.com", null, UserStatus.ACTIVE, NOW);
        when(oauthAccountRepository.findByProviderAndProviderUserId(OAuthProvider.GOOGLE, "new-subject"))
                .thenReturn(Optional.empty(), Optional.empty());
        when(userRepository.findByEmail("new.user@gmail.com")).thenReturn(Optional.empty());
        when(userRepository.save(any(User.class))).thenReturn(saved);

        TokenPairResult result = useCase.execute(loginHandoff(identity(
                "new-subject", "NEW.USER@GMAIL.COM", true, null)));

        assertEquals("new.user@gmail.com", result.user().email());
        assertEquals(NOW, result.user().emailVerifiedAt());
        assertNull(saved.getPasswordHash());
        verify(oauthAccountRepository).save(any(OAuthAccount.class));
        verify(sessionRepository).save(any(UserSession.class));
        assertEquals(1, transactionRunner.invocations);
    }

    @Test
    void newVerifiedThirdPartyEmailRemainsUnverifiedForOtp() {
        User saved = user("new.user@example.net", null, UserStatus.ACTIVE, null);
        when(oauthAccountRepository.findByProviderAndProviderUserId(OAuthProvider.GOOGLE, "third-party-subject"))
                .thenReturn(Optional.empty(), Optional.empty());
        when(userRepository.findByEmail("new.user@example.net")).thenReturn(Optional.empty());
        when(userRepository.save(any(User.class))).thenReturn(saved);

        TokenPairResult result = useCase.execute(loginHandoff(identity(
                "third-party-subject", "new.user@example.net", true, null)));

        assertNull(result.user().emailVerifiedAt());
        assertNull(saved.getEmailVerifiedAt());
        verify(oauthAccountRepository).save(any(OAuthAccount.class));
    }

    @Test
    void workspaceHostedDomainMakesVerifiedEmailAuthoritative() {
        User saved = user("new.user@acme.example", null, UserStatus.ACTIVE, NOW);
        when(oauthAccountRepository.findByProviderAndProviderUserId(OAuthProvider.GOOGLE, "workspace-subject"))
                .thenReturn(Optional.empty(), Optional.empty());
        when(userRepository.findByEmail("new.user@acme.example")).thenReturn(Optional.empty());
        when(userRepository.save(any(User.class))).thenReturn(saved);

        TokenPairResult result = useCase.execute(loginHandoff(identity(
                "workspace-subject", "new.user@acme.example", true, "acme.example")));

        assertEquals(NOW, result.user().emailVerifiedAt());
    }

    @Test
    void malformedHostedDomainDoesNotGrantEmailAuthority() {
        User saved = user("new.user@example.net", null, UserStatus.ACTIVE, null);
        when(oauthAccountRepository.findByProviderAndProviderUserId(OAuthProvider.GOOGLE, "malformed-hd-subject"))
                .thenReturn(Optional.empty(), Optional.empty());
        when(userRepository.findByEmail("new.user@example.net")).thenReturn(Optional.empty());
        when(userRepository.save(any(User.class))).thenReturn(saved);

        TokenPairResult result = useCase.execute(loginHandoff(identity(
                "malformed-hd-subject", "new.user@example.net", true, "https://evil.example")));

        assertNull(result.user().emailVerifiedAt());
        assertNull(saved.getEmailVerifiedAt());
    }

    @Test
    void existingLocalEmailRequiresExplicitLinkWithoutAnyMutation() {
        User local = user("local@example.com", "local-hash", UserStatus.ACTIVE, null);
        when(oauthAccountRepository.findByProviderAndProviderUserId(OAuthProvider.GOOGLE, "unlinked-subject"))
                .thenReturn(Optional.empty(), Optional.empty());
        when(userRepository.findByEmail("local@example.com")).thenReturn(Optional.of(local));

        OAuthAccountLinkRequiredException failure = assertThrows(
                OAuthAccountLinkRequiredException.class,
                () -> useCase.execute(loginHandoff(
                        identity("unlinked-subject", "LOCAL@example.com", true, null)))
        );

        assertEquals("ACCOUNT_LINK_REQUIRED", failure.getCode());
        verify(userRepository, never()).save(any(User.class));
        verify(oauthAccountRepository, never()).save(any(OAuthAccount.class));
        verify(sessionRepository, never()).save(any(UserSession.class));
    }

    @Test
    void missingUnverifiedOrMalformedNewEmailFailsBeforeTransactionAndWrites() {
        assertUnauthorized(() -> useCase.execute(loginHandoff(
                identity("missing-email", null, true, null))));
        assertUnauthorized(() -> useCase.execute(loginHandoff(
                identity("unverified-email", "person@example.com", false, null))));
        assertThrows(BadRequestException.class,
                () -> useCase.execute(loginHandoff(
                        identity("malformed-email", "not-an-email", true, null))));

        assertEquals(0, transactionRunner.invocations);
        verify(userRepository, never()).save(any(User.class));
        verify(oauthAccountRepository, never()).save(any(OAuthAccount.class));
        verify(sessionRepository, never()).save(any(UserSession.class));
    }

    @Test
    void subjectRaceBecomesSafeConflictWithoutQueryingAfterFailedWrite() {
        OAuthAccount winner = account(UUID.randomUUID(), "raced-subject", "raced@example.com");
        when(oauthAccountRepository.findByProviderAndProviderUserId(OAuthProvider.GOOGLE, "raced-subject"))
                .thenReturn(Optional.empty(), Optional.of(winner));
        when(userRepository.findByEmail("raced@example.com")).thenReturn(Optional.empty());

        ConflictException failure = assertThrows(
                ConflictException.class,
                () -> useCase.execute(loginHandoff(
                        identity("raced-subject", "raced@example.com", true, null)))
        );

        assertEquals("A resource conflict occurred", failure.getMessage());
        verify(userRepository, never()).save(any(User.class));
        verify(oauthAccountRepository, never()).save(any(OAuthAccount.class));
        verify(sessionRepository, never()).save(any(UserSession.class));
    }

    @Test
    void persistenceFailureDoesNotBecomeSuccessfulResultOrIssueSecondSession() {
        User saved = user("rollback@example.com", null, UserStatus.ACTIVE, NOW);
        when(oauthAccountRepository.findByProviderAndProviderUserId(OAuthProvider.GOOGLE, "rollback-subject"))
                .thenReturn(Optional.empty(), Optional.empty());
        when(userRepository.findByEmail("rollback@example.com")).thenReturn(Optional.empty());
        when(userRepository.save(any(User.class))).thenReturn(saved);
        doThrow(new IllegalStateException("injected persistence failure"))
                .when(sessionRepository).save(any(UserSession.class));

        IllegalStateException failure = assertThrows(
                IllegalStateException.class,
                () -> useCase.execute(loginHandoff(
                        identity("rollback-subject", "rollback@example.com", true, null)))
        );

        assertEquals("injected persistence failure", failure.getMessage());
        verify(accessTokenIssuer, never()).issue(any(), any(), any(), any());
        verify(sessionRepository).save(any(UserSession.class));
    }

    @Test
    void linkHandoffCannotBeUsedForLoginCompletion() {
        OAuthTransactionStore.Handoff handoff = new OAuthTransactionStore.Handoff(
                "h".repeat(43),
                "t".repeat(43),
                OAuthTransactionStore.Intent.LINK,
                "web",
                "web",
                "c".repeat(43),
                identity("subject", "person@gmail.com", true, null),
                USER_ID,
                UUID.randomUUID(),
                new com.weav.identity.application.dto.OAuthSecret("credential-fingerprint"),
                Duration.ofSeconds(60),
                5
        );

        assertThrows(IllegalArgumentException.class, () -> useCase.execute(handoff));
        assertEquals(0, transactionRunner.invocations);
    }

    private static OAuthProviderClient.ProviderIdentity identity(
            String subject,
            String email,
            boolean emailVerified,
            String hostedDomain
    ) {
        return new OAuthProviderClient.ProviderIdentity(
                OAuthProvider.GOOGLE,
                subject,
                email,
                emailVerified,
                hostedDomain,
                NOW
        );
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

    private static OAuthAccount account(UUID userId, String subject, String providerEmail) {
        return new OAuthAccount(
                UUID.randomUUID(),
                userId,
                OAuthProvider.GOOGLE,
                subject,
                providerEmail,
                NOW,
                NOW
        );
    }

    private static User user(String email, String passwordHash, UserStatus status, Instant verifiedAt) {
        return new User(
                USER_ID,
                email,
                passwordHash,
                null,
                null,
                SystemRole.USER,
                status,
                NOW.minus(Duration.ofDays(1)),
                NOW.minus(Duration.ofHours(1)),
                verifiedAt
        );
    }

    private static void assertUnauthorized(ThrowingRunnable runnable) {
        UnauthorizedException failure = assertThrows(UnauthorizedException.class, runnable::run);
        assertEquals("Authentication failed", failure.getMessage());
    }

    @FunctionalInterface
    private interface ThrowingRunnable {
        void run();
    }

    private static final class RecordingTransactionRunner implements TransactionRunner {
        private int invocations;

        @Override
        public <T> T required(Supplier<T> work) {
            invocations++;
            return work.get();
        }
    }
}
