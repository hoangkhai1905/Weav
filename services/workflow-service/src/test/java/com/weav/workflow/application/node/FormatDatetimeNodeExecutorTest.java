package com.weav.workflow.application.node;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FormatDatetimeNodeExecutorTest {

    private static final Instant NOW = Instant.parse("2026-10-05T02:00:00Z");
    private final FormatDatetimeNodeExecutor executor = new FormatDatetimeNodeExecutor(Clock.fixed(NOW, ZoneOffset.UTC));

    private static Map<String, Object> config(Object... pairs) {
        Map<String, Object> config = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            config.put((String) pairs[i], pairs[i + 1]);
        }
        return config;
    }

    private Map<String, Object> run(Object... pairs) {
        NodeExecutor.Context context = new NodeExecutor.Context(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "n", 1, "corr", null);
        return executor.execute(context, config(pairs)).output();
    }

    private NodeExecutor.Failure fails(Object... pairs) {
        return assertThrows(NodeExecutor.Failure.class, () -> run(pairs));
    }

    @Test
    void nowUsesTheTargetZoneAndUtcByDefault() {
        Map<String, Object> utc = run("operation", "now");
        assertEquals("2026-10-05T02:00:00Z", utc.get("iso"));
        assertEquals(utc.get("iso"), utc.get("value"));
        assertEquals(NOW.toEpochMilli(), utc.get("epochMs"));
        assertEquals("2026-10-05T09:00:00+07:00", run("operation", "now", "timezone", "Asia/Ho_Chi_Minh").get("iso"));
    }

    @Test
    void addAndSubtractKeepTheValuesOffsetWithoutAnExplicitZone() {
        assertEquals("2026-10-08T09:00:00+07:00",
                run("operation", "add", "value", "2026-10-05T09:00:00+07:00", "amount", 3, "unit", "days").get("iso"));
        assertEquals("2026-02-28T00:00:00Z",
                run("operation", "subtract", "value", "2026-03-31", "amount", "1", "unit", "months").get("iso"));
        assertEquals("2026-10-05T08:30:00Z",
                run("operation", "add", "value", "2026-10-05T08:00:00", "amount", 30, "unit", "minutes").get("iso"));
        assertEquals("2026-10-19T00:00:00Z",
                run("operation", "add", "value", "2026-10-05", "amount", 2, "unit", "weeks").get("iso"));
    }

    @Test
    void formatUsesPatternZoneAndLocale() {
        assertEquals("05/10/2026 09:30", run("operation", "format", "value", "2026-10-05T09:30:00+07:00",
                "pattern", "dd/MM/yyyy HH:mm").get("value"));
        assertEquals("05/10/2026 02:30", run("operation", "format", "value", "2026-10-05T09:30:00+07:00",
                "pattern", "dd/MM/yyyy HH:mm", "timezone", "UTC").get("value"));
        assertEquals("5 October 2026", run("operation", "format", "value", "2026-10-05", "pattern", "d MMMM yyyy",
                "locale", "en").get("value"));
        assertTrue(((String) run("operation", "format", "value", "2026-10-05", "pattern", "d MMMM yyyy").get("value"))
                .contains("tháng"));
    }

    @Test
    void convertChangesTheZoneAndAcceptsEpochMilliseconds() {
        assertEquals("2026-10-05T02:00:00Z", run("operation", "convert", "value", "2026-10-05T09:00:00+07:00",
                "timezone", "UTC").get("iso"));
        assertEquals("2025-10-09T15:53:20+07:00", run("operation", "convert", "value", 1760000000000L,
                "timezone", "Asia/Ho_Chi_Minh").get("iso"));
        Map<String, Object> fromText = run("operation", "convert", "value", "1760000000000", "timezone", "UTC");
        assertEquals(1760000000000L, fromText.get("epochMs"));
    }

    @Test
    void unparsableValueIsANonRetryableFormatFailure() {
        for (Object bad : new Object[] {"not a date", "2026-13-45", "", null, 1.5d}) {
            NodeExecutor.Failure failure = fails("operation", "convert", "value", bad, "timezone", "UTC");
            assertEquals("FORMAT_INVALID_DATETIME", failure.code());
            assertFalse(failure.retryable());
        }
    }

    @Test
    void invalidConfigurationIsAConfigurationError() {
        for (Object[] bad : new Object[][] {
                {"operation", "reboot"},
                {"operation", "add", "value", "2026-10-05", "amount", 100001, "unit", "days"},
                {"operation", "add", "value", "2026-10-05", "amount", 1.5, "unit", "days"},
                {"operation", "add", "value", "2026-10-05", "amount", 1, "unit", "decades"},
                {"operation", "format", "value", "2026-10-05"},
                {"operation", "format", "value", "2026-10-05", "pattern", "x".repeat(65)},
                {"operation", "format", "value", "2026-10-05", "pattern", "d", "locale", "fr"},
                {"operation", "convert", "value", "2026-10-05"},
                {"operation", "now", "timezone", "Mars/Olympus"}}) {
            NodeExecutor.Failure failure = fails(bad);
            assertEquals("CONFIGURATION_ERROR", failure.code(), String.join(",", java.util.Arrays.stream(bad)
                    .map(String::valueOf).toList()));
            assertFalse(failure.retryable());
        }
        assertEquals("FORMAT_INVALID_PATTERN", fails("operation", "format", "value", "2026-10-05",
                "pattern", "bad [pattern").code());
    }

    @Test
    void extremeYearIsAFormatFailureNotARawException() {
        NodeExecutor.Failure failure = fails("operation", "convert", "value", "+999999999-12-31T00:00:00Z", "timezone", "UTC");
        assertEquals("FORMAT_INVALID_DATETIME", failure.code());
        assertFalse(failure.retryable());
        assertEquals("FORMAT_INVALID_DATETIME", fails("operation", "format", "value", "+999999999-12-31T00:00:00Z",
                "pattern", "yyyy", "timezone", "Asia/Ho_Chi_Minh").code());
    }

    @Test
    void fieldsLeftOverFromAnotherOperationAreIgnoredAtRunTime() {
        Map<String, Object> out = run("operation", "format", "value", "2026-10-05", "pattern", "dd/MM/yyyy",
                "amount", 5, "unit", "days");
        assertEquals("05/10/2026", out.get("value"));
    }

    @Test
    void outOfRangeArithmeticIsAFormatFailure() {
        assertEquals("FORMAT_INVALID_DATETIME", fails("operation", "add", "value", "+999999999-12-31T00:00:00Z",
                "amount", 100000, "unit", "years").code());
    }
}
