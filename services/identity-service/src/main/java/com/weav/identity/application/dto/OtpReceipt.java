package com.weav.identity.application.dto;

import java.util.Objects;

public record OtpReceipt(String challengeId, long expiresIn, long retryAfter) {

    public OtpReceipt {
        if (challengeId == null || challengeId.isBlank()) {
            throw new IllegalArgumentException("challengeId must not be blank");
        }
        if (expiresIn < 1 || retryAfter < 0) {
            throw new IllegalArgumentException("OTP receipt durations are invalid");
        }
    }

    @Override
    public String toString() {
        return "OtpReceipt[challengeId=<redacted>, expiresIn=" + expiresIn + ", retryAfter=" + retryAfter + "]";
    }
}
