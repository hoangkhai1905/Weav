package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.AuthenticatedUserResult;
import com.weav.identity.application.dto.GeneratedRefreshToken;
import com.weav.identity.application.dto.IssuedAccessToken;
import com.weav.identity.application.dto.TokenPairResult;
import com.weav.identity.application.port.out.AccessTokenIssuer;
import com.weav.identity.application.port.out.OAuthProviderClient;
import com.weav.identity.application.port.out.OAuthTransactionStore;
import com.weav.identity.application.port.out.RefreshTokenGenerator;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.application.validation.GoogleEmailAuthorityPolicy;
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

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * Completes a trusted, already-consumed Google LOGIN handoff.
 *
 * <p>Transport, callback and handoff consumption stay outside this use case.
 * This class owns only the database account policy and normal session
 * issuance. A provider subject is the identity key; provider email is used
 * only when the subject is not linked yet.</p>
 */
public final class CompleteGoogleLoginUseCase {

    private static final String AUTHENTICATION_FAILED = "Authentication failed";

    private final UserRepository userRepository;
    private final OAuthAccountRepository oauthAccountRepository;
    private final UserSessionRepository sessionRepository;
    private final RefreshTokenGenerator refreshTokenGenerator;
    private final AccessTokenIssuer accessTokenIssuer;
    private final TransactionRunner transactionRunner;
    private final AuthInputPolicy inputPolicy;
    private final Clock clock;
    private final Duration sessionLifetime;

    public CompleteGoogleLoginUseCase(
            UserRepository userRepository,
            OAuthAccountRepository oauthAccountRepository,
            UserSessionRepository sessionRepository,
            RefreshTokenGenerator refreshTokenGenerator,
            AccessTokenIssuer accessTokenIssuer,
            TransactionRunner transactionRunner,
            AuthInputPolicy inputPolicy,
            Clock clock,
            Duration sessionLifetime
    ) {
        this.userRepository = Objects.requireNonNull(userRepository, "userRepository must not be null");
        this.oauthAccountRepository = Objects.requireNonNull(
                oauthAccountRepository, "oauthAccountRepository must not be null");
        this.sessionRepository = Objects.requireNonNull(sessionRepository, "sessionRepository must not be null");
        this.refreshTokenGenerator = Objects.requireNonNull(
                refreshTokenGenerator, "refreshTokenGenerator must not be null");
        this.accessTokenIssuer = Objects.requireNonNull(accessTokenIssuer, "accessTokenIssuer must not be null");
        this.transactionRunner = Objects.requireNonNull(transactionRunner, "transactionRunner must not be null");
        this.inputPolicy = Objects.requireNonNull(inputPolicy, "inputPolicy must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
        this.sessionLifetime = Objects.requireNonNull(sessionLifetime, "sessionLifetime must not be null");
        if (sessionLifetime.isZero() || sessionLifetime.isNegative()) {
            throw new IllegalArgumentException("sessionLifetime must be positive");
        }
    }

    /**
     * Completes a LOGIN handoff with no transport metadata. HTTP callers can
     * use the overload that supplies bounded user-agent and IP metadata.
     */
    public TokenPairResult execute(OAuthTransactionStore.Handoff handoff) {
        return execute(handoff, null, null);
    }

    /**
     * Completes a LOGIN handoff and creates exactly one normal Identity
     * session. The refresh token is returned to the later transport layer,
     * which decides whether it is placed in an HttpOnly cookie.
     */
    public TokenPairResult execute(
            OAuthTransactionStore.Handoff handoff,
            String userAgent,
            String ipAddress
    ) {
        Objects.requireNonNull(handoff, "handoff must not be null");
        if (handoff.intent() != OAuthTransactionStore.Intent.LOGIN) {
            throw new IllegalArgumentException("Google login requires a LOGIN handoff");
        }
        return executeTrustedIdentity(handoff.providerIdentity(), userAgent, ipAddress);
    }

    private TokenPairResult executeTrustedIdentity(
            OAuthProviderClient.ProviderIdentity identity,
            String userAgent,
            String ipAddress
    ) {
        Objects.requireNonNull(identity, "identity must not be null");
        requireGoogle(identity);

        // Existing linked subjects do not need email metadata. In particular,
        // a subject-only identity remains a valid login and no local email is
        // ever overwritten from a later provider claim.
        OAuthAccount linked = oauthAccountRepository
                .findByProviderAndProviderUserId(OAuthProvider.GOOGLE, identity.providerSubject())
                .orElse(null);
        if (linked != null) {
            return completeExistingLogin(linked, identity.providerSubject(), userAgent, ipAddress);
        }

        String canonicalEmail = requireVerifiedEmail(identity);
        boolean authoritativeEmail = GoogleEmailAuthorityPolicy.isAuthoritative(
                canonicalEmail, identity.hostedDomain());
        return transactionRunner.required(() -> completeNewLogin(
                identity,
                canonicalEmail,
                authoritativeEmail,
                userAgent,
                ipAddress
        ));
    }

    private TokenPairResult completeExistingLogin(
            OAuthAccount linked,
            String providerSubject,
            String userAgent,
            String ipAddress
    ) {
        return transactionRunner.required(() -> {
            // Lock the user first, then re-read provider ownership while the
            // lock is held. A concurrent link/disable cannot cause a session
            // to be issued for stale ownership or status.
            User lockedUser = userRepository.findByIdForUpdate(linked.getUserId())
                    .orElseThrow(CompleteGoogleLoginUseCase::authenticationFailed);
            OAuthAccount current = oauthAccountRepository
                    .findByProviderAndProviderUserId(OAuthProvider.GOOGLE, providerSubject)
                    .orElseThrow(CompleteGoogleLoginUseCase::authenticationFailed);
            if (!lockedUser.getId().equals(current.getUserId())
                    || lockedUser.getStatus() != UserStatus.ACTIVE) {
                throw authenticationFailed();
            }
            return issueSession(lockedUser, userAgent, ipAddress);
        });
    }

    private TokenPairResult completeNewLogin(
            OAuthProviderClient.ProviderIdentity identity,
            String canonicalEmail,
            boolean authoritativeEmail,
            String userAgent,
            String ipAddress
    ) {
        // Re-check both unique identities inside the transaction. The checks
        // are intentionally before any write; a concurrent winner is resolved
        // by the database constraints and the transaction is allowed to roll
        // back rather than querying after a failed flush.
        if (oauthAccountRepository
                .findByProviderAndProviderUserId(OAuthProvider.GOOGLE, identity.providerSubject())
                .isPresent()) {
            throw new ConflictException("A resource conflict occurred");
        }
        if (userRepository.findByEmail(canonicalEmail).isPresent()) {
            throw new OAuthAccountLinkRequiredException();
        }

        Instant now = clock.instant();
        User user = new User(
                UUID.randomUUID(),
                canonicalEmail,
                null,
                null,
                null,
                SystemRole.USER,
                UserStatus.ACTIVE,
                now,
                now,
                authoritativeEmail ? now : null
        );
        User savedUser = userRepository.save(user);

        OAuthAccount account = new OAuthAccount(
                UUID.randomUUID(),
                savedUser.getId(),
                OAuthProvider.GOOGLE,
                identity.providerSubject(),
                canonicalEmail,
                now,
                now
        );
        oauthAccountRepository.save(account);
        return issueSession(savedUser, userAgent, ipAddress);
    }

    private TokenPairResult issueSession(User user, String userAgent, String ipAddress) {
        if (user.getStatus() != UserStatus.ACTIVE) {
            throw authenticationFailed();
        }
        GeneratedRefreshToken refreshToken = refreshTokenGenerator.generate();
        Instant now = clock.instant();
        Instant refreshExpiresAt = now.plus(sessionLifetime);
        UserSession session = new UserSession(
                UUID.randomUUID(),
                user.getId(),
                refreshToken.hash(),
                userAgent,
                ipAddress,
                refreshExpiresAt,
                now
        );
        UserSession savedSession = sessionRepository.save(session);
        IssuedAccessToken accessToken = accessTokenIssuer.issue(
                user.getId(),
                savedSession.getId(),
                user.getSystemRole(),
                user.getStatus()
        );
        return new TokenPairResult(
                accessToken.value(),
                refreshToken.value(),
                "Bearer",
                Duration.between(now, accessToken.expiresAt()).toSeconds(),
                savedSession.getExpiresAt(),
                AuthenticatedUserResult.from(user)
        );
    }

    private String requireVerifiedEmail(OAuthProviderClient.ProviderIdentity identity) {
        if (!identity.emailVerified() || identity.providerEmail() == null) {
            throw authenticationFailed();
        }
        return inputPolicy.canonicalizeEmail(identity.providerEmail());
    }

    private static void requireGoogle(OAuthProviderClient.ProviderIdentity identity) {
        if (identity.provider() != OAuthProvider.GOOGLE) {
            throw authenticationFailed();
        }
    }

    private static UnauthorizedException authenticationFailed() {
        return new UnauthorizedException(AUTHENTICATION_FAILED);
    }
}
