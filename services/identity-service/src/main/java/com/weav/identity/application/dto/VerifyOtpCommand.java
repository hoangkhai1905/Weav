package com.weav.identity.application.dto;

import java.util.UUID;

public record VerifyOtpCommand(
        String challengeId,
        String code,
        UUID authenticatedUserId,
        UUID authenticatedSessionId,
        String remoteIp
) {

    @Override
    public String toString() {
        return "VerifyOtpCommand[challengeId=<redacted>, code=<redacted>, "
                + "authenticatedUserId=<redacted>, authenticatedSessionId=<redacted>, remoteIp=<redacted>]";
    }
}
