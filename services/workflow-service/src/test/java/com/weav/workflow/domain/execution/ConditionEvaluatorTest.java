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

    private static Map<String, Object> cond(Object left, String operator, Object right) {
        Map<String, Object> condition = new LinkedHashMap<>();
        condition.put("left", left);
        condition.put("operator", operator);
        condition.put("right", right);
        return condition;
    }

    @Test
    void andNeedsEveryConditionAndOrNeedsOne() {
        List<Object> mixed = List.of(cond(1, "eq", 1), cond(2, "gt", 5));
        assertFalse(evaluator.evaluateAll("and", mixed));
        assertTrue(evaluator.evaluateAll("or", mixed));
        assertTrue(evaluator.evaluateAll("and", List.of(cond("a", "eq", "a"), cond(3, "gte", 3))));
        assertFalse(evaluator.evaluateAll("or", List.of(cond(1, "eq", 2), cond(1, "ne", 1))));
        assertTrue(evaluator.evaluateAll("and", List.of(cond(1, "eq", 1))));
    }

    @Test
    void evaluationStopsAtTheConditionThatDecidesTheResult() {
        List<Object> badSecond = List.of(cond(1, "eq", 2), cond("text", "gt", 1));
        assertFalse(evaluator.evaluateAll("and", badSecond), "a false first condition decides and");
        List<Object> orBad = List.of(cond(1, "eq", 1), cond("text", "gt", 1));
        assertTrue(evaluator.evaluateAll("or", orBad), "a true first condition decides or");
        // An evaluated invalid comparison still fails like the single form.
        assertThrows(IllegalArgumentException.class,
                () -> evaluator.evaluateAll("and", List.of(cond(1, "eq", 1), cond("text", "gt", 1))));
        assertThrows(IllegalArgumentException.class,
                () -> evaluator.evaluateAll("or", List.of(cond(1, "eq", 2), cond("text", "gt", 1))));
    }

    @Test
    void multiFormRejectsBadCombinatorSizeAndShape() {
        assertThrows(IllegalArgumentException.class, () -> evaluator.evaluateAll("xor", List.of(cond(1, "eq", 1))));
        assertThrows(IllegalArgumentException.class, () -> evaluator.evaluateAll(null, List.of(cond(1, "eq", 1))));
        assertThrows(IllegalArgumentException.class, () -> evaluator.evaluateAll("and", List.of()));
        List<Object> eleven = java.util.Collections.nCopies(11, cond(1, "eq", 1));
        assertThrows(IllegalArgumentException.class, () -> evaluator.evaluateAll("and", eleven));
        assertTrue(evaluator.evaluateAll("and", java.util.Collections.nCopies(10, cond(1, "eq", 1))));
        assertThrows(IllegalArgumentException.class, () -> evaluator.evaluateAll("and", List.of("text")));
        Map<String, Object> noRight = cond(1, "eq", 1);
        noRight.remove("right");
        assertThrows(IllegalArgumentException.class, () -> evaluator.evaluateAll("or", List.of(noRight)));
        assertThrows(IllegalArgumentException.class,
                () -> evaluator.evaluateAll("and", List.of(cond(1, "run-code", 1))));
    }

    @Test
    void singleFormStaysExactlyAsBefore() {
        assertTrue(evaluator.evaluate(1, "eq", 1));
        assertFalse(evaluator.evaluate(1, "gt", 1));
        assertThrows(IllegalArgumentException.class, () -> evaluator.evaluate("a", "gt", 1));
    }
}
