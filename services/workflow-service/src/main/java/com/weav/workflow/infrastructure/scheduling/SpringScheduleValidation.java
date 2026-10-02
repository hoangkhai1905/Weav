package com.weav.workflow.infrastructure.scheduling;

import com.weav.workflow.application.port.out.ScheduleValidationPort;
import com.weav.workflow.domain.definition.ValidationIssue;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.zone.ZoneRules;
import java.util.List;
import java.util.Objects;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Component;

/** Cron parsing and explicit IANA-zone conversion kept outside the domain layer. */
@Component
public final class SpringScheduleValidation implements ScheduleValidationPort {
    private static final long GREGORIAN_CYCLE_DAYS = 146_097L;
    private static final LocalDateTime VALIDATION_START = LocalDateTime.of(2000, 1, 1, 0, 0);

    @Override
    public List<ValidationIssue> validate(String nodeId, String cron, String timezone) {
        CronExpression expression;
        try {
            expression = parse(cron);
        } catch (IllegalArgumentException exception) {
            return List.of(new ValidationIssue(nodeId, "config.cron", "INVALID_CRON",
                    "Cron expression must contain six valid fields."));
        }

        ZoneId zone;
        try {
            zone = zone(timezone);
        } catch (IllegalArgumentException exception) {
            return List.of(new ValidationIssue(nodeId, "config.timezone", "INVALID_TIMEZONE",
                    "Timezone must be a valid IANA timezone."));
        }

        try {
            next(expression, zone, VALIDATION_START.atZone(ZoneOffset.UTC).toInstant());
            return List.of();
        } catch (IllegalArgumentException exception) {
            return List.of(new ValidationIssue(nodeId, "config.cron", "NO_FUTURE_OCCURRENCE",
                    "Cron expression has no future occurrence in this timezone."));
        }
    }

    /** Returns the first scheduled instant strictly after {@code after}. */
    @Override
    public Instant next(String cron, String timezone, Instant after) {
        return next(parse(cron), zone(timezone), Objects.requireNonNull(after, "after must not be null"));
    }

    private Instant next(CronExpression expression, ZoneId zone, Instant after) {
        ZoneRules rules = zone.getRules();
        LocalDateTime afterLocal = LocalDateTime.ofInstant(after, zone);
        LocalDateTime candidate = expression.next(afterLocal);
        LocalDateTime horizon = afterLocal.plusDays(GREGORIAN_CYCLE_DAYS);

        while (candidate != null && !candidate.isAfter(horizon)) {
            List<ZoneOffset> offsets = rules.getValidOffsets(candidate);
            if (!offsets.isEmpty()) {
                // During a fall-back overlap, the first offset owns the wall-clock slot.
                Instant occurrence = candidate.toInstant(offsets.getFirst());
                if (occurrence.isAfter(after)) {
                    return occurrence;
                }
                // The same local time is not fired a second time in the overlap.
            }
            // A spring-forward gap has no valid offset, so that local occurrence is skipped.
            candidate = expression.next(candidate);
        }

        throw new IllegalArgumentException("Cron expression has no future occurrence in this timezone");
    }

    private CronExpression parse(String cron) {
        if (cron == null || cron.isBlank() || cron.trim().split("\\s+").length != 6) {
            throw new IllegalArgumentException("Cron expression must contain six fields");
        }
        return CronExpression.parse(cron.trim());
    }

    private ZoneId zone(String timezone) {
        if (timezone == null || !ZoneId.getAvailableZoneIds().contains(timezone)) {
            throw new IllegalArgumentException("Timezone must be an IANA timezone");
        }
        return ZoneId.of(timezone);
    }
}
