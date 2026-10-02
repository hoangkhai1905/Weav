package com.weav.identity.application.validation;

import java.time.Duration;
import java.util.Objects;

/** Immutable application policy for OTP admission and short-lived grants. */
public record OtpApplicationPolicy(
        Duration challengeTtl,
        Duration grantTtl,
        Duration resendCooldown,
        int maxChallengesPerAccount,
        int maxChallengesPerIp,
        int maxVerifyAttempts,
        int maxVerifyPerIp
) {

    public static final Duration ACCOUNT_WINDOW = Duration.ofHours(1);
    public static final Duration VERIFY_WINDOW = Duration.ofMinutes(1);

    public OtpApplicationPolicy {
        requirePositive(challengeTtl, "challengeTtl");
        requirePositive(grantTtl, "grantTtl");
        requirePositive(resendCooldown, "resendCooldown");
        requirePositive(maxChallengesPerAccount, "maxChallengesPerAccount");
        requirePositive(maxChallengesPerIp, "maxChallengesPerIp");
        requirePositive(maxVerifyAttempts, "maxVerifyAttempts");
        requirePositive(maxVerifyPerIp, "maxVerifyPerIp");
    }

    public static OtpApplicationPolicy defaults() {
        return new OtpApplicationPolicy(
                Duration.ofMinutes(5),
                Duration.ofMinutes(5),
                Duration.ofSeconds(60),
                5,
                20,
                5,
                30
        );
    }

    private static void requirePositive(Duration value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        if (value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(name + " must be positive");
        }
    }

    private static void requirePositive(int value, String name) {
        if (value < 1) {
            throw new IllegalArgumentException(name + " must be positive");
        }
    }
}
