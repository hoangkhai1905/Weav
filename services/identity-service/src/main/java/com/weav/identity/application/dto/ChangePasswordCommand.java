package com.weav.identity.application.dto;

public record ChangePasswordCommand(String currentPassword, String newPassword) {
}
