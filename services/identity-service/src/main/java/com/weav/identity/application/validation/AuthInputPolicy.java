package com.weav.identity.application.validation;

import com.weav.identity.domain.exception.BadRequestException;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Pattern;

public final class AuthInputPolicy {

    private static final int MAX_EMAIL_LENGTH = 320;
    private static final int MIN_PASSWORD_CHARACTERS = 8;
    private static final int MAX_PASSWORD_CHARACTERS = 72;
    private static final int MAX_PASSWORD_BYTES = 72;
    private static final Pattern ASCII_EMAIL = Pattern.compile(
            "^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
                    + "(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
    );

    public String canonicalizeEmail(String email) {
        if (email == null) {
            throw new BadRequestException("Email is required");
        }

        int start = 0;
        int end = email.length();
        while (start < end && email.charAt(start) == ' ') {
            start++;
        }
        while (end > start && email.charAt(end - 1) == ' ') {
            end--;
        }

        String canonical = email.substring(start, end);
        if (canonical.length() < 3 || canonical.length() > MAX_EMAIL_LENGTH) {
            throw new BadRequestException("Email is invalid");
        }
        for (int index = 0; index < canonical.length(); index++) {
            char value = canonical.charAt(index);
            if (value > 0x7f || Character.isWhitespace(value)) {
                throw new BadRequestException("Email is invalid");
            }
        }
        if (!ASCII_EMAIL.matcher(canonical).matches()) {
            throw new BadRequestException("Email is invalid");
        }
        return canonical.toLowerCase(Locale.ROOT);
    }

    public void validatePassword(String password) {
        if (password == null
                || password.length() < MIN_PASSWORD_CHARACTERS
                || password.length() > MAX_PASSWORD_CHARACTERS
                || password.getBytes(StandardCharsets.UTF_8).length > MAX_PASSWORD_BYTES) {
            throw new BadRequestException("Password must contain 8 to 72 characters and at most 72 UTF-8 bytes");
        }
    }
}
