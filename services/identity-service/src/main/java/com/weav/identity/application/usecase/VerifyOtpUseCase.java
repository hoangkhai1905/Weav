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

/** Application orchestration for OTP verification (Valkey verify outside any DB transaction) and email marking. */
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

        // ID-8: the Valkey verify is a network call, so it runs outside any DB transaction and the
        // user row lock is only held for the short re-check + write below.
        String currentCredentialFingerprint = requireMatchingState(
                userRepository.findById(userId).orElseThrow(VerifyOtpUseCase::invalidChallenge),
                metadata);
        if (metadata.purpose() == OtpChallengeStore.Purpose.EMAIL_VERIFICATION) {
            requireAuthenticatedUser(command, userId);
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
        if (metadata.purpose() == OtpChallengeStore.Purpose.PASSWORD_RESET
                && (verified.grantToken() == null || verified.grantToken().isBlank())) {
            throw invalidChallenge();
        }

        // Residual risk: the challenge is already consumed here. If the re-check or the commit below fails
        // (user disabled, credential or session changed, DB error) the caller gets a generic invalid-challenge
        // error and must request a new OTP; a consumed password-reset grant simply expires unused.
        return transactionRunner.required(() -> commitVerified(command, metadata, userId, verified));
    }

    private OtpVerificationResult commitVerified(
            VerifyOtpCommand command,
            OtpChallengeStore.ChallengeMetadata metadata,
            UUID userId,
            OtpChallengeStore.VerificationResult verified
    ) {
        User lockedUser = userRepository.findByIdForUpdate(userId)
                .orElseThrow(VerifyOtpUseCase::invalidChallenge);
        String lockedCredentialFingerprint = requireMatchingState(lockedUser, metadata);
        if (!Objects.equals(lockedCredentialFingerprint, verified.credentialFingerprint())) {
            throw invalidChallenge();
        }

        if (metadata.purpose() == OtpChallengeStore.Purpose.EMAIL_VERIFICATION) {
            requireAuthenticatedSession(command, userId, lockedUser);
            if (lockedUser.getEmailVerifiedAt() == null) {
                lockedUser.markEmailVerified(clock.instant());
                userRepository.save(lockedUser);
            }
            return OtpVerificationResult.emailVerified();
        }
        return OtpVerificationResult.passwordReset(verified.grantToken(), policy.grantTtl().toSeconds());
    }

    /** Status and fingerprint checks shared by the pre-verify read and the locked re-check. */
    private String requireMatchingState(User user, OtpChallengeStore.ChallengeMetadata metadata) {
        if (user.getStatus() != UserStatus.ACTIVE) {
            throw invalidChallenge();
        }
        String currentEmail = authInputPolicy.canonicalizeEmail(user.getEmail());
        String currentAccountFingerprint = OtpFingerprintPolicy.account(fingerprint, currentEmail);
        String currentCredentialFingerprint = OtpFingerprintPolicy.credential(
                fingerprint, user.getPasswordHash());
        if (!currentAccountFingerprint.equals(metadata.accountFingerprint())
                || !Objects.equals(currentCredentialFingerprint, metadata.credentialFingerprint())) {
            throw invalidChallenge();
        }
        if (metadata.purpose() != OtpChallengeStore.Purpose.EMAIL_VERIFICATION && !hasLocalPassword(user)) {
            throw invalidChallenge();
        }
        return currentCredentialFingerprint;
    }

    private void requireAuthenticatedUser(VerifyOtpCommand command, UUID userId) {
        if (command.authenticatedUserId() == null || command.authenticatedSessionId() == null) {
            throw new UnauthorizedException("Authentication failed");
        }
        identityGuard.requireActiveUser(command.authenticatedUserId(), command.authenticatedSessionId());
        if (!userId.equals(command.authenticatedUserId())) {
            throw new UnauthorizedException("Authentication failed");
        }
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
