package com.weav.identity.presentation.http.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record ResetPasswordRequest(
        @NotBlank(message = "Reset grant is required")
        @Size(min = 43, max = 43, message = "Reset grant is invalid")
        @Pattern(regexp = "^[A-Za-z0-9_-]{43}$", message = "Reset grant is invalid")
        String resetToken,

        @NotBlank(message = "New password is required")
        @Size(min = 8, max = 72, message = "New password must be between 8 and 72 characters")
        String newPassword
) {

    @Override
    public String toString() {
        return "ResetPasswordRequest[credentials=[REDACTED]]";
    }
}
