package com.weav.workflow.application.node;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

class FormatTextNodeExecutorTest {

    private final FormatTextNodeExecutor executor = new FormatTextNodeExecutor();

    private Object run(Object... pairs) {
        Map<String, Object> config = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            config.put((String) pairs[i], pairs[i + 1]);
        }
        NodeExecutor.Context context = new NodeExecutor.Context(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "n", 1, "corr", null);
        return executor.execute(context, config).output().get("value");
    }

    private NodeExecutor.Failure fails(Object... pairs) {
        return assertThrows(NodeExecutor.Failure.class, () -> run(pairs));
    }

    @Test
    void caseAndTrim() {
        assertEquals("ĐÀ NẴNG", run("operation", "upper", "value", "Đà Nẵng"));
        assertEquals("abc", run("operation", "lower", "value", "AbC"));
        assertEquals("a b", run("operation", "trim", "value", "  a b \n"));
    }

    @Test
    void replaceIsLiteralAndReplacesEveryOccurrence() {
        assertEquals("a-b-c", run("operation", "replace", "value", "a.b.c", "search", ".", "replacement", "-"));
        assertEquals("abc", run("operation", "replace", "value", "a.b.c", "search", "."));
        assertEquals("x", run("operation", "replace", "value", "x", "search", ".*", "replacement", "!"));
        assertEquals("CONFIGURATION_ERROR", fails("operation", "replace", "value", "x").code());
        assertEquals("CONFIGURATION_ERROR", fails("operation", "replace", "value", "x", "search", "").code());
    }

    @Test
    void splitAndJoin() {
        assertEquals(List.of("a", "b", "", "c"), run("operation", "split", "value", "a,b,,c"));
        assertEquals(List.of("a", "b"), run("operation", "split", "value", "a;;b", "separator", ";;"));
        assertEquals("a-1-b", run("operation", "join", "value", List.of("a", 1, "b"), "separator", "-"));
        assertEquals("a,b", run("operation", "join", "value", List.of("a", "b")));
        assertEquals("CONFIGURATION_ERROR", fails("operation", "join", "value", "a,b").code());
        assertEquals("CONFIGURATION_ERROR", fails("operation", "split", "value", "a", "separator", "").code());
        assertEquals("CONFIGURATION_ERROR", fails("operation", "split", "value", "a", "separator", "x".repeat(17)).code());
    }

    @Test
    void splitIsCappedAtOneThousandItems() {
        assertEquals(1000, ((List<?>) run("operation", "split", "value", "a,".repeat(999) + "a")).size());
        NodeExecutor.Failure failure = fails("operation", "split", "value", "a,".repeat(1000) + "a");
        assertEquals("FORMAT_RESULT_TOO_LARGE", failure.code());
        assertFalse(failure.retryable());
    }

    @Test
    void truncateCutsOnACodePointBoundary() {
        assertEquals("a😀", run("operation", "truncate", "value", "a😀b", "maxLength", 2));
        assertEquals("abc", run("operation", "truncate", "value", "abc", "maxLength", "10"));
        assertEquals("CONFIGURATION_ERROR", fails("operation", "truncate", "value", "abc", "maxLength", 0).code());
        assertEquals("CONFIGURATION_ERROR", fails("operation", "truncate", "value", "abc").code());
        assertEquals("CONFIGURATION_ERROR", fails("operation", "truncate", "value", "abc", "maxLength", 100001).code());
    }

    @Test
    void numberFormatFollowsTheLocale() {
        assertEquals("1.234.567,89", run("operation", "number_format", "value", "1234567.891", "decimals", 2));
        assertEquals("1,234,567.89", run("operation", "number_format", "value", 1234567.891d, "decimals", 2, "locale", "en"));
        assertEquals("1.235", run("operation", "number_format", "value", "1234.5"));
        assertEquals("-1.234,5", run("operation", "number_format", "value", -1234.5d, "decimals", "1"));
        assertEquals("0,000000", run("operation", "number_format", "value", 0, "decimals", 6));
        assertEquals("CONFIGURATION_ERROR", fails("operation", "number_format", "value", "1", "decimals", 7).code());
        assertEquals("CONFIGURATION_ERROR", fails("operation", "number_format", "value", "1", "locale", "fr").code());
    }

    @Test
    void nonNumericInputIsAFormatFailure() {
        for (Object bad : new Object[] {"abc", "", "1e999999999", "12abc", null, List.of(1)}) {
            NodeExecutor.Failure failure = fails("operation", "number_format", "value", bad);
            assertEquals("FORMAT_INVALID_NUMBER", failure.code());
            assertFalse(failure.retryable());
        }
    }

    @Test
    void overlongNumberTextIsRejectedBeforeParsing() {
        assertEquals("FORMAT_INVALID_NUMBER", fails("operation", "number_format", "value", "1".repeat(65)).code());
        assertEquals("1", run("operation", "number_format", "value", "1".repeat(1)));
    }

    @Test
    void fieldsLeftOverFromAnotherOperationAreIgnoredAtRunTime() {
        assertEquals("ABC", run("operation", "upper", "value", "abc", "search", "a", "maxLength", 1, "decimals", 3));
    }

    @Test
    void textLimitAndBadOperationAreConfigurationErrors() {
        assertEquals("CONFIGURATION_ERROR", fails("operation", "upper", "value", "x".repeat(100_001)).code());
        assertEquals("x".repeat(100_000), run("operation", "trim", "value", "x".repeat(100_000)));
        assertEquals("CONFIGURATION_ERROR", fails("operation", "titlecase", "value", "x").code());
        assertEquals("CONFIGURATION_ERROR", fails("operation", "upper", "value", new ArrayList<>(List.of("x"))).code());
    }
}
