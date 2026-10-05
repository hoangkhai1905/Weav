package com.weav.workflow.application.node;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CoreLogicNodeExecutorsTest {
    private final NodeExecutorRegistry registry = new NodeExecutorRegistry();
    private final NodeExecutor.Context context = new NodeExecutor.Context(
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "node", 1, null, null);

    private NodeExecutor.Result sw(Object value, String... cases) {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("value", value);
        config.put("cases", Arrays.asList(cases));
        return registry.require("logic.switch").execute(context, config);
    }

    @Test
    void switchMatchesTheValueAsTextAgainstTheCases() {
        assertEquals("gold", sw("gold", "gold", "silver").selectedPort());
        assertEquals("2", sw(2, "1", "2").selectedPort());
        assertEquals("2", sw(2.0, "1", "2").selectedPort());
        assertEquals("true", sw(true, "true", "false").selectedPort());
        assertEquals("-5", sw(-5L, "-5").selectedPort());
        assertEquals(Map.of("value", "gold", "port", "gold"), sw("gold", "gold").output());
    }

    @Test
    void switchComparesExactlyAndFallsBackToDefault() {
        assertEquals("default", sw("Gold", "gold").selectedPort());
        assertEquals("default", sw(" gold", "gold").selectedPort());
        assertEquals("default", sw("1.0", "1").selectedPort());
        assertEquals("default", sw(null, "null", "").selectedPort());
        assertEquals("default", sw(Map.of("a", 1), "a").selectedPort());
        assertEquals("default", sw(List.of("a"), "a").selectedPort());
        assertEquals("default", sw(3, "1", "2").selectedPort());
    }

    @Test
    void switchOutputKeepsTheResolvedValueIncludingNull() {
        NodeExecutor.Result result = sw(null, "a");
        assertEquals("default", result.output().get("port"));
        assertNull(result.output().get("value"));
        assertEquals(true, result.output().containsKey("value"));
    }

    @Test
    void switchRejectsMissingOrMalformedConfiguration() {
        NodeExecutor executor = registry.require("logic.switch");
        assertThrows(NodeExecutor.Failure.class, () -> executor.execute(context, null));
        assertThrows(NodeExecutor.Failure.class, () -> executor.execute(context, Map.of("cases", List.of("a"))));
        assertThrows(NodeExecutor.Failure.class, () -> executor.execute(context, Map.of("value", "a")));
        assertThrows(NodeExecutor.Failure.class, () -> executor.execute(context, Map.of("value", "a", "cases", "a")));
    }

    @Test
    void dataSetOutputsTheResolvedFieldsAndSelectsNoPort() {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("name", "Ada");
        fields.put("count", 7);
        fields.put("nothing", null);
        fields.put("nested", Map.of("tags", List.of("a", 1)));

        NodeExecutor.Result result = registry.require("data.set").execute(context, Map.of("fields", fields));

        assertEquals(fields, result.output());
        assertNull(result.selectedPort());
    }

    @Test
    void dataSetRejectsEmptyOversizedAndBadlyNamedFieldsAtRuntime() {
        NodeExecutor executor = registry.require("data.set");
        Map<String, Object> tooMany = new LinkedHashMap<>();
        for (int index = 0; index < 101; index++) {
            tooMany.put("k" + index, index);
        }
        for (Map<String, Object> fields : List.of(Map.<String, Object>of(), tooMany,
                Map.<String, Object>of(" ", 1), Map.<String, Object>of("a".repeat(129), 1))) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor.execute(context, Map.of("fields", fields)));
            assertEquals("CONFIGURATION_ERROR", failure.code());
            assertEquals(false, failure.retryable());
        }
        Map<String, Object> hundred = new LinkedHashMap<>();
        for (int index = 0; index < 100; index++) {
            hundred.put("k" + index, index);
        }
        assertEquals(100, executor.execute(context, Map.of("fields", hundred)).output().size());
        assertEquals(1, executor.execute(context, Map.of("fields", Map.of("a".repeat(128), 1))).output().size());
    }

    @Test
    void dataSetRejectsMissingOrNonObjectFields() {
        NodeExecutor executor = registry.require("data.set");
        assertThrows(NodeExecutor.Failure.class, () -> executor.execute(context, null));
        assertThrows(NodeExecutor.Failure.class, () -> executor.execute(context, Map.of()));
        assertThrows(NodeExecutor.Failure.class, () -> executor.execute(context, Map.of("fields", "text")));
    }
}
