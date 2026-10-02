package com.weav.workflow.domain.execution;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConditionEvaluatorTest {
    private final ConditionEvaluator evaluator = new ConditionEvaluator();

    @Test
    void comparesNestedJsonObjectsAndArraysStructurallyAcrossNumericTypes() {
        Map<String, Object> left = new LinkedHashMap<>();
        left.put("count", 1);
        left.put("details", Map.of("enabled", true));
        left.put("items", List.of(2, new BigDecimal("3.00")));

        Map<String, Object> right = new LinkedHashMap<>();
        right.put("items", List.of(2L, 3.0d));
        right.put("details", Map.of("enabled", true));
        right.put("count", new BigDecimal("1.0"));

        assertTrue(evaluator.evaluate(left, "eq", right));
        assertFalse(evaluator.evaluate(left, "ne", right));

        right.put("items", List.of(3.0d, 2L));
        assertFalse(evaluator.evaluate(left, "eq", right));
        assertTrue(evaluator.evaluate(left, "ne", right));
    }

    @Test
    void comparesExplicitJsonNullAsAValue() {
        assertTrue(evaluator.evaluate(null, "eq", null));
        assertFalse(evaluator.evaluate(null, "ne", null));
        assertFalse(evaluator.evaluate(null, "eq", "null"));
    }

    @Test
    void supportsAllOrderingOperatorsForNumericOperands() {
        assertTrue(evaluator.evaluate(10, "gt", new BigDecimal("9.5")));
        assertTrue(evaluator.evaluate(10L, "gte", new BigDecimal("10.0")));
        assertTrue(evaluator.evaluate(new BigDecimal("9.5"), "lt", 10));
        assertTrue(evaluator.evaluate(new BigDecimal("10.0"), "lte", 10L));
        assertFalse(evaluator.evaluate(10, "gt", 10L));
        assertFalse(evaluator.evaluate(10, "lt", 10L));
    }

    @Test
    void rejectsOrderingWithNonNumericOperandsAndUnknownOperators() {
        assertThrows(IllegalArgumentException.class, () -> evaluator.evaluate("10", "gt", 9));
        assertThrows(IllegalArgumentException.class, () -> evaluator.evaluate(10, "lte", null));
        assertThrows(IllegalArgumentException.class, () -> evaluator.evaluate(true, "contains", false));
        assertThrows(IllegalArgumentException.class, () -> evaluator.evaluate(1, null, 1));
    }
}
