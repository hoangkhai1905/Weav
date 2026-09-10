package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.OAuthAccountMetadata;
import com.weav.identity.application.dto.OAuthSecret;
import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OAuthProviderClient;
import com.weav.identity.application.port.out.OAuthTransactionStore;
import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
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
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.mock;

class LinkGoogleAccountUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-09-09T10:15:30Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID SESSION_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID ACCOUNT_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final String PASSWORD = "correct-horse-battery-staple";
    private static final String PASSWORD_HASH = "old-password-hash";
    private static final String CREDENTIAL_FINGERPRINT = "credential-fingerprint";

    private final UserRepository userRepository = mock(UserRepository.class);
    private final UserSessionRepository sessionRepository = mock(UserSessionRepository.class);
    private final OAuthAccountRepository oauthAccountRepository = mock(OAuthAccountRepository.class);
    private final PasswordHasher passwordHasher = mock(PasswordHasher.class);
    private final KeyedFingerprint fingerprint = mock(KeyedFingerprint.class);
    private final TransactionRunner transactionRunner = new ImmediateTransactionRunner();
    private final CurrentIdentityGuard identityGuard = new CurrentIdentityGuard(
            userRepository, sessionRepository, CLOCK);
    private final LinkGoogleAccountUseCase linkUseCase = new LinkGoogleAccountUseCase(
            identityGuard,
            userRepository,
            oauthAccountRepository,
            passwordHasher,
            fingerprint,
            transactionRunner,
            new AuthInputPolicy(),
            CLOCK);
    private final ListOAuthAccountsUseCase listUseCase = new ListOAuthAccountsUseCase(
            identityGuard, oauthAccountRepository);
    private final UnlinkOAuthAccountUseCase unlinkUseCase = new UnlinkOAuthAccountUseCase(
            identityGuard,
            userRepository,
            oauthAccountRepository,
            passwordHasher,
            transactionRunner,
            new AuthInputPolicy());

    @BeforeEach
    void stubActiveLocalIdentity() {
        when(fingerprint.fingerprint("otp-credential", PASSWORD_HASH))
                .thenReturn(CREDENTIAL_FINGERPRINT);
        when(passwordHasher.matches(PASSWORD, PASSWORD_HASH)).thenReturn(true);
    }

    @Test
    void initiationRequiresActiveSessionAndCurrentLocalPasswordAndReturnsOnlyFingerprintBinding() {
        User user = user("person@example.com", PASSWORD_HASH, UserStatus.ACTIVE, null);
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Optional.of(activeSession()));
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(user));

        LinkGoogleAccountUseCase.LinkBinding binding = linkUseCase.initiate(USER_ID, SESSION_ID, PASSWORD);

        assertEquals(USER_ID, binding.userId());
        assertEquals(SESSION_ID, binding.sessionId());
        assertEquals(CREDENTIAL_FINGERPRINT, binding.credentialFingerprint().value());
        assertFalse(binding.toString().contains(CREDENTIAL_FINGERPRINT));
        verify(passwordHasher).matches(PASSWORD, PASSWORD_HASH);
    }

    @Test
    void initiationRejectsOAuthOnlyOrWrongPassword() {
        User oauthOnly = user("person@example.com", null, UserStatus.ACTIVE, null);
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Optional.of(activeSession()));
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(oauthOnly));

        assertUnauthorized(() -> linkUseCase.initiate(USER_ID, SESSION_ID, PASSWORD));
        verify(passwordHasher, never()).matches(any(), any());

        User local = user("person@example.com", PASSWORD_HASH, UserStatus.ACTIVE, null);
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(local));
        when(passwordHasher.matches(PASSWORD, PASSWORD_HASH)).thenReturn(false);

        assertUnauthorized(() -> linkUseCase.initiate(USER_ID, SESSION_ID, PASSWORD));
    }

    @Test
    void callbackRecheckRequiresActiveUnexpiredSessionAndUnchangedCredential() {
        User user = user("person@example.com", PASSWORD_HASH, UserStatus.ACTIVE, null);
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Optional.of(activeSession()));

        linkUseCase.recheckCallback(linkTransaction(CREDENTIAL_FINGERPRINT));

        User changed = user("person@example.com", "new-password-hash", UserStatus.ACTIVE, null);
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(changed));
        assertUnauthorized(() -> linkUseCase.recheckCallback(linkTransaction(CREDENTIAL_FINGERPRINT)));

        User disabled = user("person@example.com", PASSWORD_HASH, UserStatus.DISABLED, null);
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(disabled));
        assertUnauthorized(() -> linkUseCase.recheckCallback(linkTransaction(CREDENTIAL_FINGERPRINT)));

        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Optional.of(expiredSession()));
        assertUnauthorized(() -> linkUseCase.recheckCallback(linkTransaction(CREDENTIAL_FINGERPRINT)));
    }

    @Test
    void completionLocksBearerUserRechecksBindingLinksMatchingAuthoritativeEmailAndMintsNoSession() {
        User user = user("person@gmail.com", PASSWORD_HASH, UserStatus.ACTIVE, null);
        OAuthAccount saved = account(USER_ID, "google-subject", "person@gmail.com");
        stubLockedActiveUser(user);
        when(oauthAccountRepository.findByProviderAndProviderUserId(OAuthProvider.GOOGLE, "google-subject"))
                .thenReturn(Optional.empty());
        when(oauthAccountRepository.findAllByUserId(USER_ID)).thenReturn(List.of());
        when(oauthAccountRepository.save(any(OAuthAccount.class))).thenReturn(saved);

        OAuthAccountMetadata result = linkUseCase.complete(
                USER_ID, SESSION_ID, linkHandoff(identity("google-subject", "PERSON@GMAIL.COM", true, null)));

        assertEquals(ACCOUNT_ID, result.id());
        assertEquals(OAuthProvider.GOOGLE, result.provider());
        assertEquals("person@gmail.com", result.providerEmail());
        assertEquals(NOW, user.getEmailVerifiedAt());
        verify(userRepository).findByIdForUpdate(USER_ID);
        verify(userRepository).save(user);
        verify(oauthAccountRepository).save(any(OAuthAccount.class));
        verify(sessionRepository, never()).save(any(UserSession.class));
    }

    @Test
    void completionDoesNotOverwriteOrVerifyForThirdPartyOrDifferentProviderEmail() {
        User thirdParty = user("person@example.com", PASSWORD_HASH, UserStatus.ACTIVE, null);
        stubCompletion(thirdParty, "third-party-subject", "person@example.com");
        linkUseCase.complete(
                USER_ID, SESSION_ID,
                linkHandoff(identity("third-party-subject", "person@example.com", true, null)));
        assertNull(thirdParty.getEmailVerifiedAt());
        verify(userRepository, never()).save(thirdParty);

        User differentEmail = user("person@example.com", PASSWORD_HASH, UserStatus.ACTIVE, null);
        stubCompletion(differentEmail, "different-email-subject", "other@acme.example");
        linkUseCase.complete(
                USER_ID, SESSION_ID,
                linkHandoff(identity("different-email-subject", "other@acme.example", true, "acme.example")));
        assertEquals("person@example.com", differentEmail.getEmail());
        assertNull(differentEmail.getEmailVerifiedAt());
        verify(userRepository, never()).save(differentEmail);
    }

    @Test
    void completionRejectsWrongBearerOrExistingSubjectWithoutMutation() {
        User user = user("person@example.com", PASSWORD_HASH, UserStatus.ACTIVE, null);
        stubLockedActiveUser(user);
        OAuthTransactionStore.Handoff handoff = linkHandoff(
                identity("owned-subject", "person@example.com", true, null));

        assertUnauthorized(() -> linkUseCase.complete(UUID.randomUUID(), SESSION_ID, handoff));
        verify(userRepository, never()).findByIdForUpdate(any());

        OAuthAccount owner = account(UUID.randomUUID(), "owned-subject", "owner@example.com");
        when(oauthAccountRepository.findByProviderAndProviderUserId(OAuthProvider.GOOGLE, "owned-subject"))
                .thenReturn(Optional.of(owner));
        assertThrows(ConflictException.class, () -> linkUseCase.complete(USER_ID, SESSION_ID, handoff));
        verify(oauthAccountRepository, never()).save(any(OAuthAccount.class));
    }

    @Test
    void listReturnsOnlySafeSelfMetadata() {
        User user = user("person@example.com", PASSWORD_HASH, UserStatus.ACTIVE, null);
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Optional.of(activeSession()));
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(user));
        OAuthAccount account = account(USER_ID, "secret-subject", "person@example.com");
        when(oauthAccountRepository.findAllByUserId(USER_ID)).thenReturn(List.of(account));

        List<OAuthAccountMetadata> result = listUseCase.execute(USER_ID, SESSION_ID);

        assertEquals(1, result.size());
        assertEquals(ACCOUNT_ID, result.getFirst().id());
        assertEquals("person@example.com", result.getFirst().providerEmail());
        assertFalse(result.getFirst().toString().contains("secret-subject"));
        verify(oauthAccountRepository).findAllByUserId(USER_ID);
    }

    @Test
    void unlinkUsesOwnerScopeAndPreservesLocalSession() {
        User user = user("person@example.com", PASSWORD_HASH, UserStatus.ACTIVE, null);
        stubLockedActiveUser(user);
        OAuthAccount target = account(USER_ID, "subject", "person@example.com");
        OAuthAccount other = account(USER_ID, "other-subject", null);
        when(oauthAccountRepository.findByIdAndUserId(ACCOUNT_ID, USER_ID)).thenReturn(Optional.of(target));
        when(oauthAccountRepository.findAllByUserId(USER_ID)).thenReturn(List.of(target, other));
        when(oauthAccountRepository.deleteByIdAndUserId(ACCOUNT_ID, USER_ID)).thenReturn(true);

        unlinkUseCase.execute(USER_ID, SESSION_ID, ACCOUNT_ID, PASSWORD);

        verify(oauthAccountRepository).deleteByIdAndUserId(ACCOUNT_ID, USER_ID);
        verify(sessionRepository, never()).save(any(UserSession.class));
    }

    @Test
    void unlinkReturnsSafe404ForNonOwnerAndRejectsWrongPassword() {
        User user = user("person@example.com", PASSWORD_HASH, UserStatus.ACTIVE, null);
        stubLockedActiveUser(user);
        when(oauthAccountRepository.findByIdAndUserId(ACCOUNT_ID, USER_ID)).thenReturn(Optional.empty());

        assertInstanceOf(ResourceNotFoundException.class,
                assertThrows(ResourceNotFoundException.class,
                        () -> unlinkUseCase.execute(USER_ID, SESSION_ID, ACCOUNT_ID, PASSWORD)));
        verify(oauthAccountRepository, never()).deleteByIdAndUserId(any(), any());

        OAuthAccount target = account(USER_ID, "subject", "person@example.com");
        when(oauthAccountRepository.findByIdAndUserId(ACCOUNT_ID, USER_ID)).thenReturn(Optional.of(target));
        when(oauthAccountRepository.findAllByUserId(USER_ID)).thenReturn(List.of(target));
        when(passwordHasher.matches("wrong-password", PASSWORD_HASH)).thenReturn(false);

        assertUnauthorized(() -> unlinkUseCase.execute(USER_ID, SESSION_ID, ACCOUNT_ID, "wrong-password"));
        verify(oauthAccountRepository, never()).deleteByIdAndUserId(any(), any());
    }

    @Test
    void unlinkChecksLastMethodBeforeMissingPasswordAndDoesNotDeleteOAuthOnlyAccount() {
        User oauthOnly = user("person@example.com", null, UserStatus.ACTIVE, null);
        stubLockedActiveUser(oauthOnly);
        OAuthAccount target = account(USER_ID, "subject", "person@example.com");
        when(oauthAccountRepository.findByIdAndUserId(ACCOUNT_ID, USER_ID)).thenReturn(Optional.of(target));
        when(oauthAccountRepository.findAllByUserId(USER_ID)).thenReturn(List.of(target));

        OAuthLastLoginMethodException failure = assertThrows(
                OAuthLastLoginMethodException.class,
                () -> unlinkUseCase.execute(USER_ID, SESSION_ID, ACCOUNT_ID, null));

        assertEquals("OAUTH_LAST_LOGIN_METHOD", failure.getCode());
        verify(oauthAccountRepository, never()).deleteByIdAndUserId(any(), any());
        verify(passwordHasher, never()).matches(any(), any());
    }

    private void stubLockedActiveUser(User user) {
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(user));
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Optional.of(activeSession()));
    }

    private void stubCompletion(User user, String subject, String savedProviderEmail) {
        stubLockedActiveUser(user);
        when(oauthAccountRepository.findByProviderAndProviderUserId(OAuthProvider.GOOGLE, subject))
                .thenReturn(Optional.empty());
        when(oauthAccountRepository.findAllByUserId(USER_ID)).thenReturn(List.of());
        when(oauthAccountRepository.save(any(OAuthAccount.class)))
                .thenReturn(account(USER_ID, subject, savedProviderEmail));
    }

    private static OAuthTransactionStore.Transaction linkTransaction(String credentialFingerprint) {
        return new OAuthTransactionStore.Transaction(
                "t".repeat(43),
                OAuthTransactionStore.Intent.LINK,
                "web",
                "web",
                "s".repeat(43),
                "n".repeat(43),
                new OAuthSecret("provider-verifier"),
                "c".repeat(43),
                USER_ID,
                SESSION_ID,
                new OAuthSecret(credentialFingerprint),
                Duration.ofMinutes(10));
    }

    private static OAuthTransactionStore.Handoff linkHandoff(
            OAuthProviderClient.ProviderIdentity identity) {
        return new OAuthTransactionStore.Handoff(
                "h".repeat(43),
                "t".repeat(43),
                OAuthTransactionStore.Intent.LINK,
                "web",
                "web",
                "c".repeat(43),
                identity,
                USER_ID,
                SESSION_ID,
                new OAuthSecret(CREDENTIAL_FINGERPRINT),
                Duration.ofSeconds(60),
                5);
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

    private static OAuthAccount account(UUID userId, String subject, String providerEmail) {
        return new OAuthAccount(
                ACCOUNT_ID,
                userId,
                OAuthProvider.GOOGLE,
                subject,
                providerEmail,
                NOW.minusSeconds(60),
                NOW);
    }

    private static User user(String email, String passwordHash, UserStatus status, Instant verifiedAt) {
        return new User(
                USER_ID,
                email,
                passwordHash,
                "Person",
                null,
                SystemRole.USER,
                status,
                NOW.minus(Duration.ofDays(1)),
                NOW.minus(Duration.ofHours(1)),
                verifiedAt);
    }

    private static UserSession activeSession() {
        return new UserSession(
                SESSION_ID,
                USER_ID,
                "refresh-hash",
                "JUnit",
                "127.0.0.1",
                NOW.plus(Duration.ofHours(1)),
                NOW.minus(Duration.ofMinutes(1)));
    }

    private static UserSession expiredSession() {
        return new UserSession(
                SESSION_ID,
                USER_ID,
                "refresh-hash",
                "JUnit",
                "127.0.0.1",
                NOW.minusSeconds(1),
                NOW.minus(Duration.ofMinutes(1)));
    }

    private static void assertUnauthorized(ThrowingRunnable runnable) {
        UnauthorizedException failure = assertThrows(UnauthorizedException.class, runnable::run);
        assertEquals("Authentication failed", failure.getMessage());
    }

    @FunctionalInterface
    private interface ThrowingRunnable {
        void run();
    }

    private static final class ImmediateTransactionRunner implements TransactionRunner {
        @Override
        public <T> T required(Supplier<T> work) {
            return work.get();
        }
    }
}
