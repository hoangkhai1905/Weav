package com.weav.workspace.application.validation;

import com.weav.workspace.domain.exception.BadRequestException;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Workspace-local copy of Identity's canonical email boundary rules.
 * Workspace never depends on Identity's Java classes or database.
 */
public final class IdentityEmailNormalizer {

    private static final int MAX_EMAIL_LENGTH = 320;
    private static final Pattern ASCII_EMAIL = Pattern.compile(
            "^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
                    + "(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$");

    private IdentityEmailNormalizer() {
    }

    public static String canonicalize(String email) {
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
}
