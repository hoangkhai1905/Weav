package com.weav.identity.infrastructure.security;

import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BcryptPasswordHasherTest {

    private final BcryptPasswordHasher passwordHasher =
            new BcryptPasswordHasher(new BCryptPasswordEncoder());

    @Test
    void hashesAndMatchesPasswordsWithoutChangingExistingBcryptCompatibility() {
        String encoded = passwordHasher.hash("correct horse battery staple");
        String existingHash = new BCryptPasswordEncoder().encode("existing-password");

        assertTrue(encoded.startsWith("$2"));
        assertTrue(passwordHasher.matches("correct horse battery staple", encoded));
        assertFalse(passwordHasher.matches("wrong-password", encoded));
        assertTrue(passwordHasher.matches("existing-password", existingHash));
    }

    @Test
    void acceptsAtMostSeventyTwoUtf8Bytes() {
        assertTrue(passwordHasher.matches("a".repeat(72), passwordHasher.hash("a".repeat(72))));
        assertThrows(IllegalArgumentException.class, () -> passwordHasher.hash("a".repeat(73)));

        String seventyTwoUtf8Bytes = "é".repeat(36);
        String seventyFourUtf8Bytes = "é".repeat(37);
        assertTrue(passwordHasher.matches(seventyTwoUtf8Bytes, passwordHasher.hash(seventyTwoUtf8Bytes)));
        assertThrows(IllegalArgumentException.class, () -> passwordHasher.hash(seventyFourUtf8Bytes));
    }
}
