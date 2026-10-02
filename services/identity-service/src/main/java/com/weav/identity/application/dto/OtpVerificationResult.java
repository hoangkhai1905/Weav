package com.weav.identity.application.dto;

import com.weav.identity.application.port.out.OtpChallengeStore;

public record OtpVerificationResult(
        OtpChallengeStore.Purpose purpose,
        boolean verified,
        String resetToken,
        long expiresIn
) {

    public OtpVerificationResult {
        if (purpose == null || !verified || expiresIn < 0) {
            throw new IllegalArgumentException("OTP verification result is invalid");
        }
        if (purpose == OtpChallengeStore.Purpose.EMAIL_VERIFICATION
                && (resetToken != null || expiresIn != 0)) {
            throw new IllegalArgumentException("email verification result must not contain a reset grant");
        }
        if (purpose == OtpChallengeStore.Purpose.PASSWORD_RESET
                && (resetToken == null || resetToken.isBlank() || expiresIn < 1)) {
            throw new IllegalArgumentException("password reset result must contain a reset grant");
        }
    }

    public static OtpVerificationResult emailVerified() {
        return new OtpVerificationResult(OtpChallengeStore.Purpose.EMAIL_VERIFICATION, true, null, 0);
    }

    public static OtpVerificationResult passwordReset(String resetToken, long expiresIn) {
        return new OtpVerificationResult(OtpChallengeStore.Purpose.PASSWORD_RESET, true, resetToken, expiresIn);
    }

    @Override
    public String toString() {
        return "OtpVerificationResult[purpose=" + purpose + ", verified=" + verified
                + ", resetToken=<redacted>, expiresIn=" + expiresIn + "]";
    }
}
