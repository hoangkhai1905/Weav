package com.weav.identity.presentation.http.response;

public record OtpReceiptResponse(String challengeId, long expiresIn, long retryAfter) {

    public static OtpReceiptResponse from(com.weav.identity.application.dto.OtpReceipt receipt) {
        return new OtpReceiptResponse(receipt.challengeId(), receipt.expiresIn(), receipt.retryAfter());
    }

    @Override
    public String toString() {
        return "OtpReceiptResponse[challengeId=<redacted>, expiresIn=" + expiresIn
                + ", retryAfter=" + retryAfter + "]";
    }
}
