package com.weav.identity.application.validation;

import com.weav.identity.application.port.out.OtpChallengeStore;
import com.weav.identity.domain.exception.BadRequestException;

import java.util.regex.Pattern;

/** Boundary validation for opaque OTP identifiers, codes and client address keys. */
public final class OtpInputPolicy {

    private static final Pattern OPAQUE_TOKEN = Pattern.compile("^[A-Za-z0-9_-]{43}$");
    private static final Pattern OTP_CODE = Pattern.compile("^[0-9]{6}$");

    public String requireChallengeId(String challengeId) {
        return requireOpaqueToken(challengeId, "Challenge identifier");
    }

    public String requireResetToken(String resetToken) {
        return requireOpaqueToken(resetToken, "Reset grant");
    }

    public String requireCode(String code) {
        if (code == null || !OTP_CODE.matcher(code).matches()) {
            throw new BadRequestException("OTP code is invalid");
        }
        return code;
    }

    public String requireRemoteIp(String remoteIp) {
        if (remoteIp == null || remoteIp.isBlank() || remoteIp.length() > 255
                || remoteIp.chars().anyMatch(Character::isWhitespace)
                || remoteIp.chars().anyMatch(Character::isISOControl)) {
            throw new BadRequestException("Remote address is invalid");
        }
        return remoteIp;
    }

    public void requirePurpose(OtpChallengeStore.Purpose purpose) {
        if (purpose == null) {
            throw new BadRequestException("OTP purpose is required");
        }
    }

    private static String requireOpaqueToken(String value, String label) {
        if (value == null || !OPAQUE_TOKEN.matcher(value).matches()) {
            throw new BadRequestException(label + " is invalid");
        }
        return value;
    }
}
