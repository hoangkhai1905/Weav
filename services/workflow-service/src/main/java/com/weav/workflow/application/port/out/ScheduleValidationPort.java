package com.weav.workflow.application.port.out;

import com.weav.workflow.domain.definition.DefinitionValidator;
import java.time.Instant;

/** Validates scheduled trigger definitions and calculates their next occurrence. */
public interface ScheduleValidationPort extends DefinitionValidator.ScheduleValidation {
    /** Returns the first scheduled instant strictly after {@code after}. */
    Instant next(String cron, String timezone, Instant after);
}
