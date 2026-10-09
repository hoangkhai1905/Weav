package com.weav.workflow.domain.template;

import org.junit.jupiter.api.Test;

import java.security.SecureRandom;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ShareCodeTest {

    @Test
    void generatedCodesAreEightAlphabetCharacters() {
        SecureRandom random = new SecureRandom();
        for (int i = 0; i < 200; i++) {
            String code = ShareCode.generate(random);
            assertEquals(8, code.length());
            assertTrue(code.chars().allMatch(c -> ShareCode.ALPHABET.indexOf(c) >= 0), code);
        }
    }

    @Test
    void normalizeIgnoresCaseSpacesAndDashes() {
        assertEquals(Optional.of("WV7K3M9Q"), ShareCode.normalize("wv7k-3m9q"));
        assertEquals(Optional.of("WV7K3M9Q"), ShareCode.normalize("  Wv7k 3M9q "));
    }

    @Test
    void normalizeReadsLookalikesAsDigits() {
        assertEquals(Optional.of("0110ABCD"), ShareCode.normalize(" o1l0 abcd "));
        assertEquals(Optional.of("11ABCDEF"), ShareCode.normalize("iLabcdef"));
    }

    @Test
    void normalizeRejectsWrongLengthAndForeignCharacters() {
        assertEquals(Optional.empty(), ShareCode.normalize("short"));
        assertEquals(Optional.empty(), ShareCode.normalize("UUUUUUUU"));
        assertEquals(Optional.empty(), ShareCode.normalize("ABCDEFGHJ"));
        assertEquals(Optional.empty(), ShareCode.normalize(""));
        assertEquals(Optional.empty(), ShareCode.normalize(null));
    }
}
