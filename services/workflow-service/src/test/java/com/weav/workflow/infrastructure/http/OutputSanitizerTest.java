package com.weav.workflow.infrastructure.http;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

class OutputSanitizerTest {

    @Test
    void recursivelyDropsSensitiveFieldsAndHeaders() {
        Map<String, Object> value = Map.of(
                "status", 200,
                "Authorization", "Bearer access-token",
                "nested", Map.of(
                        "safe", "value",
                        "Set-Cookie", "session=private",
                        "access_token", "access-token"),
                "items", List.of(Map.of("name", "kept", "password", "discarded")));

        Object sanitized = OutputSanitizer.sanitize(value, Set.of("access-token"));

        Map<?, ?> root = assertInstanceOf(Map.class, sanitized);
        assertEquals(200, root.get("status"));
        assertFalse(root.containsKey("Authorization"));
        Map<?, ?> nested = assertInstanceOf(Map.class, root.get("nested"));
        assertEquals("value", nested.get("safe"));
        assertFalse(nested.containsKey("Set-Cookie"));
        assertFalse(nested.containsKey("access_token"));
        List<?> items = assertInstanceOf(List.class, root.get("items"));
        Map<?, ?> item = assertInstanceOf(Map.class, items.getFirst());
        assertEquals("kept", item.get("name"));
        assertFalse(item.containsKey("password"));
    }

    @Test
    void scrubsActiveSecretsAndSignedUrlQueryValuesInStrings() {
        Map<String, Object> value = Map.of(
                "message", "echo=top-secret",
                "url", "https://example.test/callback?X-Amz-Signature=abc123&ok=1",
                "array", List.of("top-secret", "safe"));

        Map<?, ?> sanitized = assertInstanceOf(Map.class,
                OutputSanitizer.sanitize(value, Set.of("top-secret", "abc123")));

        assertEquals("echo=[REDACTED]", sanitized.get("message"));
        assertEquals("https://example.test/callback?X-Amz-Signature=[REDACTED]&ok=1", sanitized.get("url"));
        assertEquals(List.of("[REDACTED]", "safe"), sanitized.get("array"));
    }

    @Test
    void leavesPrimitiveValuesAndInputObjectsSafeToReuse() {
        Map<String, Object> value = Map.of("count", 3, "enabled", true);

        Object sanitized = OutputSanitizer.sanitize(value, Set.of());

        assertEquals(value, sanitized);
    }
}
