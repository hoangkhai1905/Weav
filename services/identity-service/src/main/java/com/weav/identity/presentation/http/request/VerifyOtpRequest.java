package com.weav.identity.presentation.http.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record VerifyOtpRequest(
        @NotBlank(message = "Challenge identifier is required")
        @Size(min = 43, max = 43, message = "Challenge identifier is invalid")
        @Pattern(regexp = "^[A-Za-z0-9_-]{43}$", message = "Challenge identifier is invalid")
        String challengeId,

        @NotBlank(message = "OTP code is required")
        @Size(min = 6, max = 6, message = "OTP code is invalid")
        @Pattern(regexp = "^[0-9]{6}$", message = "OTP code is invalid")
        String code
) {

    @Override
    public String toString() {
        return "VerifyOtpRequest[challengeId=<redacted>, code=<redacted>]";
    }
}
