package com.weav.workflow.infrastructure.ocr;

import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Duration;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OcrClientPropertiesTest {

    private static final Duration THIRTY = Duration.ofSeconds(30);

    @Test
    void sourcesRequireEveryGateInTheirChain() {
        assertEquals(List.of("url", "artifact"), props(true, true, true, true, true, true, THIRTY).enabledSources());
        assertEquals(List.of("url"), props(true, true, false, true, true, true, THIRTY).enabledSources());
        assertEquals(List.of("artifact"), props(true, false, true, true, true, true, THIRTY).enabledSources());
        // A closed source-specific gate removes only its own source; the master gates remove both.
        assertEquals(List.of("artifact"), props(true, true, true, true, false, true, THIRTY).enabledSources());
        assertEquals(List.of("url"), props(true, true, true, true, true, false, THIRTY).enabledSources());
        assertEquals(List.of(), props(false, true, true, true, true, true, THIRTY).enabledSources());
        assertEquals(List.of(), props(true, true, true, false, true, true, THIRTY).enabledSources());
        assertEquals(List.of(), props(true, false, false, true, true, true, THIRTY).enabledSources());
    }

    @Test
    void signingKeyIsConfiguredOnlyWithBothKeyIdAndLocation() {
        assertTrue(props(true, true, true, true, true, true, "k", "file:///k.pem", THIRTY).signingKeyConfigured());
        assertFalse(props(true, true, true, true, true, true, "", "file:///k.pem", THIRTY).signingKeyConfigured());
        assertFalse(props(true, true, true, true, true, true, "k", " ", THIRTY).signingKeyConfigured());
        assertFalse(props(true, true, true, true, true, true, null, null, THIRTY).signingKeyConfigured());
    }

    @Test
    void readTimeoutAllowsTheNinetySecondOcrContractUpToOneHundredTwentySeconds() {
        assertEquals(Duration.ofSeconds(95),
                props(true, true, true, true, true, true, Duration.ofSeconds(95)).readTimeout());
        assertEquals(Duration.ofSeconds(120),
                props(true, true, true, true, true, true, Duration.ofSeconds(120)).readTimeout());
        assertThrows(IllegalArgumentException.class,
                () -> props(true, true, true, true, true, true, Duration.ofSeconds(121)));
        assertThrows(IllegalArgumentException.class,
                () -> props(true, true, true, true, true, true, Duration.ZERO));
    }

    @Test
    void toStringNeverExposesKeyMaterialLocations() {
        String text = props(true, true, true, true, true, true, "secret-kid", "file:///private/key.pem", THIRTY)
                .toString();
        assertFalse(text.contains("secret-kid"));
        assertFalse(text.contains("key.pem"));
    }

    private static OcrClientProperties props(boolean enabled, boolean url, boolean artifact, boolean claims,
                                             boolean allowlist, boolean resolver, Duration readTimeout) {
        return props(enabled, url, artifact, claims, allowlist, resolver, "key-id", "file:///key.pem", readTimeout);
    }

    private static OcrClientProperties props(boolean enabled, boolean url, boolean artifact, boolean claims,
                                             boolean allowlist, boolean resolver, String keyId, String keyLocation,
                                             Duration readTimeout) {
        return new OcrClientProperties(enabled, url, artifact, claims, allowlist, resolver,
                URI.create("http://ocr.internal"), keyId, keyLocation,
                Duration.ofSeconds(5), readTimeout, Duration.ofSeconds(60), 1_048_576);
    }
}
