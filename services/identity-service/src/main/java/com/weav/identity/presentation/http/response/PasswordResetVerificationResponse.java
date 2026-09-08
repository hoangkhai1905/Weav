package com.weav.identity.presentation.http.response;

public record PasswordResetVerificationResponse(String purpose, String resetToken, long expiresIn) {

    public PasswordResetVerificationResponse(String resetToken, long expiresIn) {
        this("PASSWORD_RESET", resetToken, expiresIn);
    }

    @Override
    public String toString() {
        return "PasswordResetVerificationResponse[purpose=" + purpose
                + ", resetToken=<redacted>, expiresIn=" + expiresIn + "]";
    }
}
