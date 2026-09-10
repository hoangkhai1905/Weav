package com.weav.identity.application.dto;

public record LoginCommand(String email, String password, String userAgent, String ipAddress) {

    public LoginCommand(String email, String password) {
        this(email, password, null, null);
    }
}
