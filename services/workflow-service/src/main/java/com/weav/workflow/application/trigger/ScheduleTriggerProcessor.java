package com.weav.workflow.application.trigger;

import com.weav.workflow.application.port.out.ExecutionAdmissionPort;
import com.weav.workflow.application.port.out.ScheduleValidationPort;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Performs one scheduled admission and advances its durable slot atomically. */
@Service
public class ScheduleTriggerProcessor {
    private final WorkflowRepository workflows;
    private final WorkflowTriggerPort triggers;
    private final ExecutionAdmissionService admissions;
    private final ScheduleValidationPort schedules;

    public ScheduleTriggerProcessor(WorkflowRepository workflows, WorkflowTriggerPort triggers,
                                    ExecutionAdmissionService admissions,
                                    ScheduleValidationPort schedules) {
        this.workflows = Objects.requireNonNull(workflows);
        this.triggers = Objects.requireNonNull(triggers);
        this.admissions = Objects.requireNonNull(admissions);
        this.schedules = Objects.requireNonNull(schedules);
    }

    @Transactional
    public boolean process(WorkflowTriggerPort.ScheduleCandidate candidate, Instant scanTime) {
        Objects.requireNonNull(candidate, "candidate must not be null");
        Objects.requireNonNull(scanTime, "scanTime must not be null");

        // Match automatic admission's lock order: workflow row, then trigger row.
        Workflow workflow = workflows.lockById(candidate.workflowId()).orElse(null);
        if (workflow == null) {
            return false;
        }
        Optional<WorkflowTrigger> locked = triggers.lockCurrent(candidate.workflowId(), candidate.triggerId());
        if (locked.isEmpty()) {
            return false;
        }
        WorkflowTrigger trigger = locked.get();
        if (workflow.getStatus() != WorkflowStatus.PUBLISHED
                || workflow.getCurrentVersionId() == null
                || !workflow.getCurrentVersionId().equals(trigger.getWorkflowVersionId())
                || trigger.getStatus() != TriggerStatus.ACTIVE
                || trigger.getType() != TriggerType.SCHEDULE) {
            return false;
        }

        String cron = stringConfig(trigger, "cron");
        String timezone = stringConfig(trigger, "timezone");
        if (trigger.getNextRunAt() == null) {
            triggers.initializeSchedule(trigger.getId(), schedules.next(cron, timezone, scanTime));
            return false;
        }
        Instant scheduledAt = trigger.getNextRunAt();
        if (scheduledAt.isAfter(scanTime)) {
            return false;
        }

        Instant nextRunAt = schedules.next(cron, timezone, scanTime);
        if (!nextRunAt.isAfter(scheduledAt)) {
            throw new IllegalStateException("Schedule next run did not advance beyond the admitted slot");
        }
        ExecutionAdmissionPort.Admission admission = admissions.automatic(trigger.getId(),
                Map.of("scheduledAt", scheduledAt.toString()), scheduledAt, null, null);
        Objects.requireNonNull(admission, "schedule admission must return a result");
        triggers.advanceSchedule(trigger.getId(), scheduledAt, nextRunAt);
        return true;
    }

    private String stringConfig(WorkflowTrigger trigger, String field) {
        Object value = trigger.getConfig().get(field);
        if (value instanceof String text && !text.isBlank()) {
            return text;
        }
        throw new IllegalStateException("Stored schedule registration is missing validated configuration");
    }
}
