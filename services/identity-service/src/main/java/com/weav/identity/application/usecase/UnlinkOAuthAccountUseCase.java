package com.weav.identity.application.usecase;

import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.domain.exception.OAuthLastLoginMethodException;
import com.weav.identity.domain.exception.ResourceNotFoundException;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.model.OAuthAccount;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.OAuthAccountRepository;
import com.weav.identity.domain.port.out.UserRepository;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

/** Removes one owner-scoped OAuth account without changing the current session. */
public final class UnlinkOAuthAccountUseCase {

    private static final String AUTHENTICATION_FAILED = "Authentication failed";

    private final CurrentIdentityGuard identityGuard;
    private final UserRepository userRepository;
    private final OAuthAccountRepository oauthAccountRepository;
    private final PasswordHasher passwordHasher;
    private final TransactionRunner transactionRunner;
    private final AuthInputPolicy inputPolicy;

    public UnlinkOAuthAccountUseCase(
            CurrentIdentityGuard identityGuard,
            UserRepository userRepository,
            OAuthAccountRepository oauthAccountRepository,
            PasswordHasher passwordHasher,
            TransactionRunner transactionRunner,
            AuthInputPolicy inputPolicy
    ) {
        this.identityGuard = Objects.requireNonNull(identityGuard, "identityGuard must not be null");
        this.userRepository = Objects.requireNonNull(userRepository, "userRepository must not be null");
        this.oauthAccountRepository = Objects.requireNonNull(
                oauthAccountRepository, "oauthAccountRepository must not be null");
        this.passwordHasher = Objects.requireNonNull(passwordHasher, "passwordHasher must not be null");
        this.transactionRunner = Objects.requireNonNull(transactionRunner, "transactionRunner must not be null");
        this.inputPolicy = Objects.requireNonNull(inputPolicy, "inputPolicy must not be null");
    }

    public void execute(UUID userId, UUID sessionId, UUID accountId, String currentPassword) {
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        Objects.requireNonNull(accountId, "accountId must not be null");

        identityGuard.requireActiveUser(userId, sessionId);
        transactionRunner.required(() -> {
            User lockedUser = userRepository.findByIdForUpdate(userId)
                    .orElseThrow(UnlinkOAuthAccountUseCase::unauthorized);
            identityGuard.requireActiveSessionForLockedUser(lockedUser, userId, sessionId);

            OAuthAccount target = oauthAccountRepository.findByIdAndUserId(accountId, userId)
                    .orElseThrow(() -> new ResourceNotFoundException("Resource not found"));
            List<OAuthAccount> accounts = oauthAccountRepository.findAllByUserId(userId);
            boolean hasLocalPassword = hasLocalPassword(lockedUser);
            boolean hasAnotherOAuthAccount = accounts.stream()
                    .anyMatch(account -> !account.getId().equals(target.getId()));
            if (!hasLocalPassword && !hasAnotherOAuthAccount) {
                throw new OAuthLastLoginMethodException();
            }

            inputPolicy.validatePassword(currentPassword);
            if (!hasLocalPassword
                    || !passwordHasher.matches(currentPassword, lockedUser.getPasswordHash())) {
                throw unauthorized();
            }
            if (!oauthAccountRepository.deleteByIdAndUserId(accountId, userId)) {
                throw new ResourceNotFoundException("Resource not found");
            }
            return null;
        });
    }

    private static boolean hasLocalPassword(User user) {
        return user.getPasswordHash() != null && !user.getPasswordHash().isBlank();
    }

    private static UnauthorizedException unauthorized() {
        return new UnauthorizedException(AUTHENTICATION_FAILED);
    }
}
