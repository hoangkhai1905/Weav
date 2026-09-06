package com.weav.identity.infrastructure.security;

import com.weav.identity.application.port.out.PasswordHasher;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.nio.charset.StandardCharsets;
import java.util.Objects;

public final class BcryptPasswordHasher implements PasswordHasher {

    private static final int MAX_PASSWORD_BYTES = 72;

    private final PasswordEncoder passwordEncoder;

    public BcryptPasswordHasher(PasswordEncoder passwordEncoder) {
        this.passwordEncoder = Objects.requireNonNull(passwordEncoder, "passwordEncoder must not be null");
    }

    @Override
    public String hash(String rawPassword) {
        validateLength(rawPassword);
        return passwordEncoder.encode(rawPassword);
    }

    @Override
    public boolean matches(String rawPassword, String encodedPassword) {
        validateLength(rawPassword);
        if (encodedPassword == null || encodedPassword.isBlank()) {
            return false;
        }
        return passwordEncoder.matches(rawPassword, encodedPassword);
    }

    private static void validateLength(String rawPassword) {
        Objects.requireNonNull(rawPassword, "rawPassword must not be null");
        if (rawPassword.getBytes(StandardCharsets.UTF_8).length > MAX_PASSWORD_BYTES) {
            throw new IllegalArgumentException("password must not exceed 72 UTF-8 bytes");
        }
    }
}
