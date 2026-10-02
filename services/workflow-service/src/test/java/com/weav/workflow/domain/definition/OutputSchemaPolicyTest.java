package com.weav.workflow.domain.definition;

import org.junit.jupiter.api.Test;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OutputSchemaPolicyTest {

    @Test
    @SuppressWarnings("unchecked")
    void matchesTheSharedTypeScriptFixture() throws Exception {
        Path fixture = Path.of("..", "..", "packages", "contracts", "http", "ai", "fixtures", "output-schema-profile.json");
        Class<?> mapperType = Class.forName("tools.jackson.databind.ObjectMapper");
        Object mapper = mapperType.getConstructor().newInstance();
        @SuppressWarnings("unchecked")
        Map<String, Object> root = (Map<String, Object>) mapperType.getMethod("readValue", String.class, Class.class)
                .invoke(mapper, Files.readString(fixture), Map.class);
        for (Map<String, Object> testCase : (List<Map<String, Object>>) root.get("cases")) {
            assertEquals(testCase.get("valid"), OutputSchemaPolicy.isValid(testCase.get("schema")), (String) testCase.get("name"));
        }
    }

    @Test
    void enforcesDepthEight() {
        assertTrue(OutputSchemaPolicy.isValid(nested(8)));
        assertFalse(OutputSchemaPolicy.isValid(nested(9)));
    }

    private static Map<String, Object> nested(int depth) {
        return depth == 1
                ? Map.of("type", "object", "properties", Map.of())
                : Map.of("type", "object", "properties", Map.of("c", nested(depth - 1)));
    }
}
