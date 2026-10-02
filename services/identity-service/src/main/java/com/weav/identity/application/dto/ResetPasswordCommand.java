package com.weav.identity.application.dto;

public record ResetPasswordCommand(String resetToken, String newPassword) {

    @Override
    public String toString() {
        return "ResetPasswordCommand[resetToken=<redacted>, newPassword=<redacted>]";
    }
}
