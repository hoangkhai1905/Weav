package com.weav.identity.infrastructure.config;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OtpPropertiesTest {

    @Test
    void absentAndWeakSecretsAreUnavailableWithoutBreakingPropertyValidation() {
        OtpProperties properties = new OtpProperties();
        properties.validate();
        assertFalse(properties.isConfigured());

        properties.setHmacSecret("short");
        assertFalse(properties.isConfigured());
    }

    @Test
    void rejectsInvalidDurationsAndLimits() {
        OtpProperties properties = new OtpProperties();
        properties.setChallengeTtl(Duration.ZERO);
        assertThrows(IllegalArgumentException.class, properties::validate);
    }
}
