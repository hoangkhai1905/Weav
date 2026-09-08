package com.weav.identity.presentation.http.response;

public record EmailVerificationResponse(String purpose, boolean verified) {

    public EmailVerificationResponse() {
        this("EMAIL_VERIFICATION", true);
    }
}
