package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.ResetPasswordCommand;
import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OtpChallengeStore;
import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.application.validation.OtpFingerprintPolicy;
import com.weav.identity.application.validation.OtpInputPolicy;
import com.weav.identity.domain.exception.BadRequestException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;
import com.weav.identity.domain.valueobject.UserStatus;

import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** Application orchestration for one-use password reset grant redemption. */
public final class ResetPasswordUseCase {

    private static final String INVALID_GRANT = "Reset grant is invalid";

    private final UserRepository userRepository;
    private final UserSessionRepository sessionRepository;
    private final OtpChallengeStore challengeStore;
    private final KeyedFingerprint fingerprint;
    private final PasswordHasher passwordHasher;
    private final TransactionRunner transactionRunner;
    private final AuthInputPolicy authInputPolicy;
    private final OtpInputPolicy otpInputPolicy;
    private final Clock clock;

    public ResetPasswordUseCase(
            UserRepository userRepository,
            UserSessionRepository sessionRepository,
            OtpChallengeStore challengeStore,
            KeyedFingerprint fingerprint,
            PasswordHasher passwordHasher,
            TransactionRunner transactionRunner,
            AuthInputPolicy authInputPolicy,
            OtpInputPolicy otpInputPolicy,
            Clock clock
    ) {
        this.userRepository = Objects.requireNonNull(userRepository, "userRepository must not be null");
        this.sessionRepository = Objects.requireNonNull(sessionRepository, "sessionRepository must not be null");
        this.challengeStore = Objects.requireNonNull(challengeStore, "challengeStore must not be null");
        this.fingerprint = Objects.requireNonNull(fingerprint, "fingerprint must not be null");
        this.passwordHasher = Objects.requireNonNull(passwordHasher, "passwordHasher must not be null");
        this.transactionRunner = Objects.requireNonNull(transactionRunner, "transactionRunner must not be null");
        this.authInputPolicy = Objects.requireNonNull(authInputPolicy, "authInputPolicy must not be null");
        this.otpInputPolicy = Objects.requireNonNull(otpInputPolicy, "otpInputPolicy must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    public void execute(ResetPasswordCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        String resetToken = otpInputPolicy.requireResetToken(command.resetToken());
        authInputPolicy.validatePassword(command.newPassword());

        // Consume before the expensive hash so random public tokens cannot
        // turn BCrypt into an unauthenticated work queue. A failed hash still
        // loses the grant, which preserves at-most-once redemption.
        OtpChallengeStore.GrantConsumptionResult grant = challengeStore.consumeGrant(resetToken);
        if (grant == null || !grant.consumed()
                || grant.purpose() != OtpChallengeStore.Purpose.PASSWORD_RESET
                || grant.userId() == null
                || grant.accountFingerprint() == null
                || grant.credentialFingerprint() == null) {
            throw invalidGrant();
        }

        UUID userId = parseUserId(grant.userId());
        // BCrypt is deliberately outside the user lock and transaction.
        String replacementHash = passwordHasher.hash(command.newPassword());
        transactionRunner.required(() -> {
            User lockedUser = userRepository.findByIdForUpdate(userId)
                    .orElseThrow(ResetPasswordUseCase::invalidGrant);
            verifyCurrentBinding(lockedUser, grant);

            Instant now = clock.instant();
            lockedUser.changePassword(replacementHash, now);
            lockedUser.markEmailVerified(now);
            userRepository.save(lockedUser);
            sessionRepository.revokeAllForUser(userId, now);
            return null;
        });
    }

    private void verifyCurrentBinding(User user, OtpChallengeStore.GrantConsumptionResult grant) {
        if (user.getStatus() != UserStatus.ACTIVE || !hasLocalPassword(user)) {
            throw invalidGrant();
        }
        String currentEmail = authInputPolicy.canonicalizeEmail(user.getEmail());
        String currentAccountFingerprint = OtpFingerprintPolicy.account(fingerprint, currentEmail);
        String currentCredentialFingerprint = OtpFingerprintPolicy.credential(
                fingerprint, user.getPasswordHash());
        if (!currentAccountFingerprint.equals(grant.accountFingerprint())
                || !currentCredentialFingerprint.equals(grant.credentialFingerprint())) {
            throw invalidGrant();
        }
    }

    private static UUID parseUserId(String value) {
        try {
            return UUID.fromString(value);
        } catch (RuntimeException exception) {
            throw invalidGrant();
        }
    }

    private static boolean hasLocalPassword(User user) {
        return user.getPasswordHash() != null && !user.getPasswordHash().isBlank();
    }

    private static BadRequestException invalidGrant() {
        return new BadRequestException(INVALID_GRANT);
    }
}
