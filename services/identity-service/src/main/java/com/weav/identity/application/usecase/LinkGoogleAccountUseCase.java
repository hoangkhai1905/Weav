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
import com.weav.identity.application.validation.GoogleEmailAuthorityPolicy;
import com.weav.identity.application.validation.OtpFingerprintPolicy;
import com.weav.identity.domain.exception.ConflictException;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.model.OAuthAccount;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.OAuthAccountRepository;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.valueobject.OAuthProvider;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * Owns the authenticated Google LINK binding and account mutation.
 *
 * <p>OAuth transport creates and consumes the short-lived transaction and
 * handoff records. This use case only validates their trusted bindings and
 * performs the final user-first locked account mutation.</p>
 */
public final class LinkGoogleAccountUseCase {

    private static final String AUTHENTICATION_FAILED = "Authentication failed";
    private static final String RESOURCE_CONFLICT = "A resource conflict occurred";

    private final CurrentIdentityGuard identityGuard;
    private final UserRepository userRepository;
    private final OAuthAccountRepository oauthAccountRepository;
    private final PasswordHasher passwordHasher;
    private final KeyedFingerprint fingerprint;
    private final TransactionRunner transactionRunner;
    private final AuthInputPolicy inputPolicy;
    private final Clock clock;

    public LinkGoogleAccountUseCase(
            CurrentIdentityGuard identityGuard,
            UserRepository userRepository,
            OAuthAccountRepository oauthAccountRepository,
            PasswordHasher passwordHasher,
            KeyedFingerprint fingerprint,
            TransactionRunner transactionRunner,
            AuthInputPolicy inputPolicy,
            Clock clock
    ) {
        this.identityGuard = Objects.requireNonNull(identityGuard, "identityGuard must not be null");
        this.userRepository = Objects.requireNonNull(userRepository, "userRepository must not be null");
        this.oauthAccountRepository = Objects.requireNonNull(
                oauthAccountRepository, "oauthAccountRepository must not be null");
        this.passwordHasher = Objects.requireNonNull(passwordHasher, "passwordHasher must not be null");
        this.fingerprint = Objects.requireNonNull(fingerprint, "fingerprint must not be null");
        this.transactionRunner = Objects.requireNonNull(transactionRunner, "transactionRunner must not be null");
        this.inputPolicy = Objects.requireNonNull(inputPolicy, "inputPolicy must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    /**
     * Authenticates the local session and captures only a keyed credential
     * binding for the later callback and exchange checks.
     */
    public LinkBinding initiate(UUID userId, UUID sessionId, String currentPassword) {
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        inputPolicy.validatePassword(currentPassword);

        User candidate = identityGuard.requireActiveUser(userId, sessionId);
        if (!hasLocalPassword(candidate)
                || !passwordHasher.matches(currentPassword, candidate.getPasswordHash())) {
            throw unauthorized();
        }

        return new LinkBinding(
                userId,
                sessionId,
                new OAuthSecret(OtpFingerprintPolicy.credential(fingerprint, candidate.getPasswordHash())));
    }

    /**
     * Rechecks a consumed callback transaction before transport issues a LINK
     * handoff. The callback has no trusted bearer identity, so it uses only the
     * server-bound user/session IDs from the transaction.
     */
    public void recheckCallback(OAuthTransactionStore.Transaction transaction) {
        Objects.requireNonNull(transaction, "transaction must not be null");
        if (transaction.intent() != OAuthTransactionStore.Intent.LINK) {
            throw new IllegalArgumentException("link callback requires a LINK transaction");
        }

        transactionRunner.required(() -> {
            User lockedUser = userRepository.findByIdForUpdate(transaction.userId())
                    .orElseThrow(LinkGoogleAccountUseCase::unauthorized);
            identityGuard.requireActiveSessionForLockedUser(
                    lockedUser,
                    transaction.userId(),
                    transaction.sessionId());
            requireCurrentCredential(lockedUser, transaction.credentialFingerprint());
            return null;
        });
    }

    /**
     * Completes a consumed LINK handoff for the currently authenticated bearer
     * session. It never creates a session or returns token material.
     */
    public OAuthAccountMetadata complete(
            UUID authenticatedUserId,
            UUID authenticatedSessionId,
            OAuthTransactionStore.Handoff handoff
    ) {
        Objects.requireNonNull(authenticatedUserId, "authenticatedUserId must not be null");
        Objects.requireNonNull(authenticatedSessionId, "authenticatedSessionId must not be null");
        Objects.requireNonNull(handoff, "handoff must not be null");
        if (handoff.intent() != OAuthTransactionStore.Intent.LINK
                || handoff.providerIdentity().provider() != OAuthProvider.GOOGLE
                || !authenticatedUserId.equals(handoff.userId())
                || !authenticatedSessionId.equals(handoff.sessionId())) {
            throw unauthorized();
        }

        return transactionRunner.required(() -> {
            User lockedUser = userRepository.findByIdForUpdate(authenticatedUserId)
                    .orElseThrow(LinkGoogleAccountUseCase::unauthorized);
            identityGuard.requireActiveSessionForLockedUser(
                    lockedUser,
                    authenticatedUserId,
                    authenticatedSessionId);
            requireCurrentCredential(lockedUser, handoff.credentialFingerprint());

            OAuthProviderClient.ProviderIdentity identity = handoff.providerIdentity();
            OAuthAccount subjectOwner = oauthAccountRepository
                    .findByProviderAndProviderUserId(OAuthProvider.GOOGLE, identity.providerSubject())
                    .orElse(null);
            if (subjectOwner != null) {
                throw new ConflictException(RESOURCE_CONFLICT);
            }

            List<OAuthAccount> existingAccounts = oauthAccountRepository.findAllByUserId(authenticatedUserId);
            if (existingAccounts.stream().anyMatch(account -> account.getProvider() == OAuthProvider.GOOGLE)) {
                throw new ConflictException(RESOURCE_CONFLICT);
            }

            String providerEmail = canonicalProviderEmail(identity);
            String localEmail = inputPolicy.canonicalizeEmail(lockedUser.getEmail());
            boolean authoritativeMatch = providerEmail != null
                    && identity.emailVerified()
                    && GoogleEmailAuthorityPolicy.isAuthoritative(providerEmail, identity.hostedDomain())
                    && providerEmail.equals(localEmail);
            if (authoritativeMatch && lockedUser.getEmailVerifiedAt() == null) {
                lockedUser.markEmailVerified(clock.instant());
                userRepository.save(lockedUser);
            }

            Instant now = clock.instant();
            OAuthAccount account = new OAuthAccount(
                    UUID.randomUUID(),
                    authenticatedUserId,
                    OAuthProvider.GOOGLE,
                    identity.providerSubject(),
                    providerEmail,
                    now,
                    now);
            return OAuthAccountMetadata.from(oauthAccountRepository.save(account));
        });
    }

    private void requireCurrentCredential(User lockedUser, OAuthSecret expectedFingerprint) {
        String currentFingerprint = hasLocalPassword(lockedUser)
                ? OtpFingerprintPolicy.credential(fingerprint, lockedUser.getPasswordHash())
                : null;
        if (expectedFingerprint == null
                || !Objects.equals(currentFingerprint, expectedFingerprint.value())) {
            throw unauthorized();
        }
    }

    private String canonicalProviderEmail(OAuthProviderClient.ProviderIdentity identity) {
        return identity.providerEmail() == null
                ? null
                : inputPolicy.canonicalizeEmail(identity.providerEmail());
    }

    private static boolean hasLocalPassword(User user) {
        return user.getPasswordHash() != null && !user.getPasswordHash().isBlank();
    }

    private static UnauthorizedException unauthorized() {
        return new UnauthorizedException(AUTHENTICATION_FAILED);
    }

    public record LinkBinding(UUID userId, UUID sessionId, OAuthSecret credentialFingerprint) {
        public LinkBinding {
            Objects.requireNonNull(userId, "userId must not be null");
            Objects.requireNonNull(sessionId, "sessionId must not be null");
            Objects.requireNonNull(credentialFingerprint, "credentialFingerprint must not be null");
        }

        @Override
        public String toString() {
            return "LinkBinding[userId=<redacted>, sessionId=<redacted>, credentialFingerprint=<redacted>]";
        }
    }
}
