package com.weav.identity.application.dto;

import com.weav.identity.application.port.out.OtpChallengeStore;

import java.util.UUID;

public record RequestOtpCommand(
        OtpChallengeStore.Purpose purpose,
        String email,
        UUID authenticatedUserId,
        UUID authenticatedSessionId,
        String remoteIp
) {

    @Override
    public String toString() {
        return "RequestOtpCommand[purpose=" + purpose
                + ", email=<redacted>, authenticatedUserId=<redacted>, "
                + "authenticatedSessionId=<redacted>, remoteIp=<redacted>]";
    }
}
