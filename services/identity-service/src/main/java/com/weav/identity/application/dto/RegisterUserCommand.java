package com.weav.identity.application.dto;

public record RegisterUserCommand(String email, String password, String displayName) {
}
