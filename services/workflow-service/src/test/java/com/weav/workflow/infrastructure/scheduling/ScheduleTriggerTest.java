package com.weav.workflow.infrastructure.scheduling;

import com.weav.workflow.domain.definition.ValidationIssue;
import java.time.Instant;
import java.util.List;
import java.util.TimeZone;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ScheduleTriggerTest {
    private final SpringScheduleValidation schedules = new SpringScheduleValidation();

    @Test
    void publishValidationRequiresSixFieldsAndAnIanaTimezone() {
        List<ValidationIssue> valid = schedules.validate("schedule", "0 0 9 * * *", "Asia/Ho_Chi_Minh");
        assertTrue(valid.isEmpty());

        List<ValidationIssue> fiveFields = schedules.validate("schedule", "0 9 * * *", "Asia/Ho_Chi_Minh");
        assertTrue(fiveFields.stream().anyMatch(issue -> issue.code().equals("INVALID_CRON")));

        List<ValidationIssue> invalidZone = schedules.validate("schedule", "0 0 9 * * *", "+07:00");
        assertTrue(invalidZone.stream().anyMatch(issue -> issue.code().equals("INVALID_TIMEZONE")));
    }

    @Test
    void nextOccurrenceUsesItsTimezoneInsteadOfTheJvmDefault() {
        TimeZone original = TimeZone.getDefault();
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("Pacific/Honolulu"));

            assertEquals(Instant.parse("2026-09-21T02:00:00Z"), schedules.next(
                    "0 0 9 * * *", "Asia/Ho_Chi_Minh", Instant.parse("2026-09-21T01:59:59Z")));
        } finally {
            TimeZone.setDefault(original);
        }
    }

    @Test
    void nonexistentDstWallTimeIsSkipped() {
        assertEquals(Instant.parse("2026-03-09T06:30:00Z"), schedules.next(
                "0 30 2 * * *", "America/New_York", Instant.parse("2026-03-08T06:59:59Z")));
    }

    @Test
    void repeatedDstWallTimeRunsOnceAtItsEarlierOffset() {
        assertEquals(Instant.parse("2026-11-01T05:30:00Z"), schedules.next(
                "0 30 1 * * *", "America/New_York", Instant.parse("2026-11-01T04:00:00Z")));
        assertEquals(Instant.parse("2026-11-02T06:30:00Z"), schedules.next(
                "0 30 1 * * *", "America/New_York", Instant.parse("2026-11-01T05:31:00Z")));
    }

    @Test
    void impossibleCronHasNoNextOccurrence() {
        String cron = "0 0 0 31 2 *";
        assertTrue(schedules.validate("schedule", cron, "UTC").stream()
                .anyMatch(issue -> issue.code().equals("NO_FUTURE_OCCURRENCE")));
        assertThrows(IllegalArgumentException.class,
                () -> schedules.next(cron, "UTC", Instant.parse("2026-01-01T00:00:00Z")));
    }
}
