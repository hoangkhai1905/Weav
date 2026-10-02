package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.OtpReceipt;
import com.weav.identity.application.dto.RequestOtpCommand;
import com.weav.identity.application.port.out.AuthMailDispatcher;
import com.weav.identity.application.port.out.AuthMailSender;
import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OtpChallengeStore;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.application.validation.OtpApplicationPolicy;
import com.weav.identity.application.validation.OtpFingerprintPolicy;
import com.weav.identity.application.validation.OtpInputPolicy;
import com.weav.identity.application.validation.OtpRateLimitException;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.valueobject.UserStatus;

import java.security.SecureRandom;
import java.util.Locale;
import java.util.Objects;

/** Application orchestration for both email verification and password-reset OTP requests. */
public final class RequestOtpUseCase {

    private static final String ACCOUNT_SCOPE = "otp:account";
    private static final String COOLDOWN_SCOPE = "otp:cooldown";
    private static final String IP_SCOPE = "otp:ip";
    private static final int OTP_BOUND = 1_000_000;

    private final UserRepository userRepository;
    private final CurrentIdentityGuard identityGuard;
    private final OtpChallengeStore challengeStore;
    private final KeyedFingerprint fingerprint;
    private final AuthMailDispatcher mailDispatcher;
    private final AuthInputPolicy authInputPolicy;
    private final OtpInputPolicy otpInputPolicy;
    private final OtpApplicationPolicy policy;
    private final SecureRandom secureRandom;

    public RequestOtpUseCase(
            UserRepository userRepository,
            CurrentIdentityGuard identityGuard,
            OtpChallengeStore challengeStore,
            KeyedFingerprint fingerprint,
            AuthMailDispatcher mailDispatcher,
            AuthInputPolicy authInputPolicy,
            OtpInputPolicy otpInputPolicy,
            OtpApplicationPolicy policy,
            SecureRandom secureRandom
    ) {
        this.userRepository = Objects.requireNonNull(userRepository, "userRepository must not be null");
        this.identityGuard = Objects.requireNonNull(identityGuard, "identityGuard must not be null");
        this.challengeStore = Objects.requireNonNull(challengeStore, "challengeStore must not be null");
        this.fingerprint = Objects.requireNonNull(fingerprint, "fingerprint must not be null");
        this.mailDispatcher = Objects.requireNonNull(mailDispatcher, "mailDispatcher must not be null");
        this.authInputPolicy = Objects.requireNonNull(authInputPolicy, "authInputPolicy must not be null");
        this.otpInputPolicy = Objects.requireNonNull(otpInputPolicy, "otpInputPolicy must not be null");
        this.policy = Objects.requireNonNull(policy, "policy must not be null");
        this.secureRandom = Objects.requireNonNull(secureRandom, "secureRandom must not be null");
    }

    public OtpReceipt execute(RequestOtpCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        otpInputPolicy.requirePurpose(command.purpose());
        String remoteIp = otpInputPolicy.requireRemoteIp(command.remoteIp());
        String requestedEmail = command.purpose() == OtpChallengeStore.Purpose.PASSWORD_RESET
                ? authInputPolicy.canonicalizeEmail(command.email())
                : requireEmailAbsent(command.email());

        try (AuthMailDispatcher.Lease lease = mailDispatcher.reserve()) {
            reserve(IP_SCOPE, OtpFingerprintPolicy.remoteIp(fingerprint, remoteIp),
                    policy.maxChallengesPerIp(), OtpApplicationPolicy.ACCOUNT_WINDOW);

            return command.purpose() == OtpChallengeStore.Purpose.PASSWORD_RESET
                    ? requestPasswordReset(requestedEmail, lease)
                    : requestEmailVerification(command, lease);
        }
    }

    private OtpReceipt requestPasswordReset(
            String canonicalEmail,
            AuthMailDispatcher.Lease lease
    ) {
        String accountFingerprint = OtpFingerprintPolicy.account(fingerprint, canonicalEmail);
        reserveAccount(accountFingerprint);

        User user = userRepository.findByEmail(canonicalEmail).orElse(null);
        if (!isEligibleForPasswordReset(user)) {
            // Keep an accepted but non-deliverable request from resurrecting a
            // prior challenge or reset grant if the account changes state.
            challengeStore.invalidatePurpose(accountFingerprint, OtpChallengeStore.Purpose.PASSWORD_RESET);
            lease.dispatch(null, null);
            return receipt(challengeStore.newChallengeId());
        }

        return issueEligibleChallenge(user, accountFingerprint, OtpChallengeStore.Purpose.PASSWORD_RESET, lease);
    }

    private OtpReceipt requestEmailVerification(
            RequestOtpCommand command,
            AuthMailDispatcher.Lease lease
    ) {
        if (command.authenticatedUserId() == null || command.authenticatedSessionId() == null) {
            throw new UnauthorizedException("Authentication failed");
        }

        User user = identityGuard.requireActiveUser(
                command.authenticatedUserId(), command.authenticatedSessionId());
        String canonicalEmail = authInputPolicy.canonicalizeEmail(user.getEmail());
        String accountFingerprint = OtpFingerprintPolicy.account(fingerprint, canonicalEmail);
        reserveAccount(accountFingerprint);
        return issueEligibleChallenge(user, accountFingerprint, command.purpose(), lease);
    }

    private OtpReceipt issueEligibleChallenge(
            User user,
            String accountFingerprint,
            OtpChallengeStore.Purpose purpose,
            AuthMailDispatcher.Lease lease
    ) {
        String challengeId = challengeStore.newChallengeId();
        String code = nextCode();
        String userId = user.getId().toString();
        String credentialFingerprint = OtpFingerprintPolicy.credential(fingerprint, user.getPasswordHash());
        String codeFingerprint = OtpFingerprintPolicy.code(
                fingerprint, challengeId, purpose, userId, accountFingerprint, code);
        OtpChallengeStore.Challenge challenge = new OtpChallengeStore.Challenge(
                challengeId,
                purpose,
                accountFingerprint,
                userId,
                codeFingerprint,
                credentialFingerprint,
                policy.challengeTtl()
        );

        OtpChallengeStore.ChallengeReceipt stored = challengeStore.issue(challenge);
        try {
            AuthMailSender.Message message = new AuthMailSender.Message(
                    user.getEmail(),
                    purpose == OtpChallengeStore.Purpose.EMAIL_VERIFICATION
                            ? "Weav email verification code"
                            : "Weav password reset code",
                    "Your Weav security code is " + code + ". It expires in "
                            + policy.challengeTtl().toMinutes() + " minutes."
            );
            lease.dispatch(message, () -> challengeStore.invalidate(challenge));
        } catch (RuntimeException failure) {
            invalidateQuietly(challenge);
            throw failure;
        }
        return new OtpReceipt(challengeId, stored.expiresInSeconds(), policy.resendCooldown().toSeconds());
    }

    private void reserveAccount(String accountFingerprint) {
        reserve(COOLDOWN_SCOPE, accountFingerprint, 1, policy.resendCooldown());
        reserve(ACCOUNT_SCOPE, accountFingerprint, policy.maxChallengesPerAccount(), OtpApplicationPolicy.ACCOUNT_WINDOW);
    }

    private void reserve(String scope, String key, int limit, java.time.Duration window) {
        OtpChallengeStore.AdmissionResult admission = challengeStore.reserve(scope, key, limit, window);
        if (!admission.allowed()) {
            throw new OtpRateLimitException(admission.retryAfterSeconds());
        }
    }

    private OtpReceipt receipt(String challengeId) {
        return new OtpReceipt(challengeId, policy.challengeTtl().toSeconds(), policy.resendCooldown().toSeconds());
    }

    private String nextCode() {
        return String.format(Locale.ROOT, "%06d", secureRandom.nextInt(OTP_BOUND));
    }

    private static boolean isEligibleForPasswordReset(User user) {
        return user != null
                && user.getStatus() == UserStatus.ACTIVE
                && user.getPasswordHash() != null
                && !user.getPasswordHash().isBlank();
    }

    private static String requireEmailAbsent(String email) {
        if (email != null) {
            throw new com.weav.identity.domain.exception.BadRequestException(
                    "Email must not be supplied for email verification");
        }
        return null;
    }

    private void invalidateQuietly(OtpChallengeStore.Challenge challenge) {
        try {
            challengeStore.invalidate(challenge);
        } catch (RuntimeException ignored) {
            // The original dependency failure is the actionable result.
        }
    }
}
