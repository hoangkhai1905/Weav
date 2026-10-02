package com.weav.identity.presentation.http.request;

import com.weav.identity.application.port.out.OtpChallengeStore;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Purpose-discriminated OTP request; email presence is intentionally tracked separately from its value. */
public final class OtpRequest {

    private static final String EMAIL_PATTERN = "^ *[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+ *$";

    @NotNull(message = "purpose is required")
    private OtpChallengeStore.Purpose purpose;

    @Pattern(regexp = EMAIL_PATTERN, message = "Email must be valid")
    @Size(max = 320, message = "Email must not exceed 320 characters")
    private String email;

    private boolean emailPresent;

    public OtpRequest() {
    }

    public OtpChallengeStore.Purpose purpose() {
        return purpose;
    }

    public void setPurpose(OtpChallengeStore.Purpose purpose) {
        this.purpose = purpose;
    }

    public String email() {
        return email;
    }

    public void setEmail(String email) {
        this.emailPresent = true;
        this.email = email;
    }

    public boolean hasEmail() {
        return emailPresent;
    }

    @Override
    public String toString() {
        return "OtpRequest[purpose=" + purpose + ", email=<redacted>]";
    }
}
