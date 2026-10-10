package com.weav.workflow.domain.template;

import java.util.Optional;
import java.util.random.RandomGenerator;

/** 8-character Crockford base32 template codes (no I, L, O, U), typed forgivingly by people. */
public final class ShareCode {
    public static final String ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    public static final int LENGTH = 8;

    private ShareCode() {
    }

    /** Production callers pass a {@code SecureRandom}. */
    public static String generate(RandomGenerator random) {
        StringBuilder code = new StringBuilder(LENGTH);
        for (int i = 0; i < LENGTH; i++) {
            code.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        }
        return code.toString();
    }

    /** Uppercases, ignores spaces and dashes, reads I and L as 1 and O as 0; empty unless exactly a valid code. */
    public static Optional<String> normalize(String input) {
        if (input == null) {
            return Optional.empty();
        }
        StringBuilder code = new StringBuilder(LENGTH);
        for (char c : input.toUpperCase(java.util.Locale.ROOT).toCharArray()) {
            if (Character.isWhitespace(c) || c == '-') {
                continue;
            }
            code.append(c == 'I' || c == 'L' ? '1' : c == 'O' ? '0' : c);
        }
        String result = code.toString();
        return result.length() == LENGTH && result.chars().allMatch(c -> ALPHABET.indexOf(c) >= 0)
                ? Optional.of(result) : Optional.empty();
    }
}
