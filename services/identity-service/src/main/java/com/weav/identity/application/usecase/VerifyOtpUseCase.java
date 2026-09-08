package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.OtpVerificationResult;
import com.weav.identity.application.dto.VerifyOtpCommand;
import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OtpChallengeStore;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.application.validation.OtpApplicationPolicy;
import com.weav.identity.application.validation.OtpFingerprintPolicy;
import com.weav.identity.application.validation.OtpInputPolicy;
import com.weav.identity.application.validation.OtpRateLimitException;
import com.weav.identity.domain.exception.BadRequestException;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.valueobject.UserStatus;

import java.time.Clock;
import java.util.Objects;
import java.util.UUID;

/** Application orchestration for atomic OTP verification and email marking. */
public final class VerifyOtpUseCase {

    private static final String VERIFY_IP_SCOPE = "otp:verify:ip";
    private static final String INVALID_CHALLENGE = "OTP challenge is invalid";

    private final UserRepository userRepository;
    private final CurrentIdentityGuard identityGuard;
    private final OtpChallengeStore challengeStore;
    private final KeyedFingerprint fingerprint;
    private final AuthInputPolicy authInputPolicy;
    private final OtpInputPolicy otpInputPolicy;
    private final OtpApplicationPolicy policy;
    private final com.weav.identity.application.port.out.TransactionRunner transactionRunner;
    private final Clock clock;

    public VerifyOtpUseCase(
            UserRepository userRepository,
            CurrentIdentityGuard identityGuard,
            OtpChallengeStore challengeStore,
            KeyedFingerprint fingerprint,
            AuthInputPolicy authInputPolicy,
            OtpInputPolicy otpInputPolicy,
            OtpApplicationPolicy policy,
            com.weav.identity.application.port.out.TransactionRunner transactionRunner,
            Clock clock
    ) {
        this.userRepository = Objects.requireNonNull(userRepository, "userRepository must not be null");
        this.identityGuard = Objects.requireNonNull(identityGuard, "identityGuard must not be null");
        this.challengeStore = Objects.requireNonNull(challengeStore, "challengeStore must not be null");
        this.fingerprint = Objects.requireNonNull(fingerprint, "fingerprint must not be null");
        this.authInputPolicy = Objects.requireNonNull(authInputPolicy, "authInputPolicy must not be null");
        this.otpInputPolicy = Objects.requireNonNull(otpInputPolicy, "otpInputPolicy must not be null");
        this.policy = Objects.requireNonNull(policy, "policy must not be null");
        this.transactionRunner = Objects.requireNonNull(transactionRunner, "transactionRunner must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    public OtpVerificationResult execute(VerifyOtpCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        String challengeId = otpInputPolicy.requireChallengeId(command.challengeId());
        String code = otpInputPolicy.requireCode(command.code());
        String remoteIp = otpInputPolicy.requireRemoteIp(command.remoteIp());
        reserveVerifyIp(remoteIp);

        OtpChallengeStore.ChallengeMetadata metadata = challengeStore.lookup(challengeId);
        if (metadata == null) {
            throw invalidChallenge();
        }
        if (!challengeId.equals(metadata.challengeId())) {
            throw invalidChallenge();
        }
        UUID userId = parseUserId(metadata.userId());

        return transactionRunner.required(() -> verifyLocked(command, challengeId, code, metadata, userId));
    }

    private OtpVerificationResult verifyLocked(
            VerifyOtpCommand command,
            String challengeId,
            String code,
            OtpChallengeStore.ChallengeMetadata metadata,
            UUID userId
    ) {
        User lockedUser = userRepository.findByIdForUpdate(userId)
                .orElseThrow(VerifyOtpUseCase::invalidChallenge);
        if (lockedUser.getStatus() != UserStatus.ACTIVE) {
            throw invalidChallenge();
        }

        String currentEmail = authInputPolicy.canonicalizeEmail(lockedUser.getEmail());
        String currentAccountFingerprint = OtpFingerprintPolicy.account(fingerprint, currentEmail);
        String currentCredentialFingerprint = OtpFingerprintPolicy.credential(
                fingerprint, lockedUser.getPasswordHash());
        if (!currentAccountFingerprint.equals(metadata.accountFingerprint())
                || !Objects.equals(currentCredentialFingerprint, metadata.credentialFingerprint())) {
            throw invalidChallenge();
        }

        if (metadata.purpose() == OtpChallengeStore.Purpose.EMAIL_VERIFICATION) {
            requireAuthenticatedSession(command, userId, lockedUser);
        } else if (!hasLocalPassword(lockedUser)) {
            throw invalidChallenge();
        }

        String codeFingerprint = OtpFingerprintPolicy.code(
                fingerprint,
                challengeId,
                metadata.purpose(),
                metadata.userId(),
                metadata.accountFingerprint(),
                code
        );
        OtpChallengeStore.VerificationResult verified = challengeStore.verify(
                new OtpChallengeStore.VerificationAttempt(
                        challengeId,
                        codeFingerprint,
                        policy.maxVerifyAttempts(),
                        metadata.purpose() == OtpChallengeStore.Purpose.PASSWORD_RESET
                                ? policy.grantTtl()
                                : null
                )
        );
        if (verified == null
                || !verified.verified()
                || verified.purpose() != metadata.purpose()
                || !userId.toString().equals(verified.userId())
                || !Objects.equals(currentCredentialFingerprint, verified.credentialFingerprint())) {
            throw invalidChallenge();
        }

        if (metadata.purpose() == OtpChallengeStore.Purpose.EMAIL_VERIFICATION) {
            if (lockedUser.getEmailVerifiedAt() == null) {
                lockedUser.markEmailVerified(clock.instant());
                userRepository.save(lockedUser);
            }
            return OtpVerificationResult.emailVerified();
        }

        if (verified.grantToken() == null || verified.grantToken().isBlank()) {
            throw invalidChallenge();
        }
        return OtpVerificationResult.passwordReset(verified.grantToken(), policy.grantTtl().toSeconds());
    }

    private void requireAuthenticatedSession(VerifyOtpCommand command, UUID userId, User lockedUser) {
        if (command.authenticatedUserId() == null || command.authenticatedSessionId() == null) {
            throw new UnauthorizedException("Authentication failed");
        }
        identityGuard.requireActiveSessionForLockedUser(
                lockedUser,
                command.authenticatedUserId(),
                command.authenticatedSessionId()
        );
        if (!userId.equals(command.authenticatedUserId())) {
            throw new UnauthorizedException("Authentication failed");
        }
    }

    private void reserveVerifyIp(String remoteIp) {
        String key = OtpFingerprintPolicy.remoteIp(fingerprint, remoteIp);
        OtpChallengeStore.AdmissionResult admission = challengeStore.reserve(
                VERIFY_IP_SCOPE,
                key,
                policy.maxVerifyPerIp(),
                OtpApplicationPolicy.VERIFY_WINDOW
        );
        if (!admission.allowed()) {
            throw new OtpRateLimitException(admission.retryAfterSeconds());
        }
    }

    private static UUID parseUserId(String value) {
        try {
            return UUID.fromString(value);
        } catch (RuntimeException exception) {
            throw invalidChallenge();
        }
    }

    private static boolean hasLocalPassword(User user) {
        return user.getPasswordHash() != null && !user.getPasswordHash().isBlank();
    }

    private static BadRequestException invalidChallenge() {
        return new BadRequestException(INVALID_CHALLENGE);
    }
}
