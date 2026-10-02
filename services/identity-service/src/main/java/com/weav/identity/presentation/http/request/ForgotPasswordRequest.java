package com.weav.identity.presentation.http.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record ForgotPasswordRequest(
        @NotBlank(message = "Email is required")
        @Pattern(
                regexp = "^ *[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+ *$",
                message = "Email must be valid"
        )
        @Size(max = 320, message = "Email must not exceed 320 characters")
        String email
) {

    @Override
    public String toString() {
        return "ForgotPasswordRequest[email=<redacted>]";
    }
}
