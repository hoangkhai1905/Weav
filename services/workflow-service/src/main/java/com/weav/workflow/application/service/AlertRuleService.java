package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.AlertRuleStore;
import com.weav.workflow.application.port.out.AlertRuleStore.AlertRule;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.exception.ConflictException;
import com.weav.workflow.domain.exception.ResourceNotFoundException;
import com.weav.workflow.domain.valueobject.AlertRuleType;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/** Alert-rule CRUD: read needs WORKFLOW_MONITOR, changes need WORKFLOW_EDIT (the capability that edits workflows). */
@Service
public final class AlertRuleService {
    static final String EDIT_CAPABILITY = "WORKFLOW_EDIT";
    public static final int MAX_RULES_PER_WORKSPACE = 20;
    public static final int DEFAULT_COOLDOWN_MINUTES = 60;

    private final WorkspaceAuthorization workspaceAuthorization;
    private final AlertRuleStore store;
    private final Clock clock;

    public AlertRuleService(WorkspaceAuthorization workspaceAuthorization, AlertRuleStore store,
                            @Qualifier("workflowExecutionClock") Clock clock) {
        this.workspaceAuthorization = Objects.requireNonNull(workspaceAuthorization);
        this.store = Objects.requireNonNull(store);
        this.clock = Objects.requireNonNull(clock);
    }

    public List<AlertRule> list(UUID workspaceId, UUID actorId) {
        workspaceAuthorization.require(workspaceId, actorId, MonitoringService.MONITOR_CAPABILITY);
        return store.list(workspaceId);
    }

    public AlertRule create(UUID workspaceId, UUID actorId, RuleInput input) {
        workspaceAuthorization.require(workspaceId, actorId, EDIT_CAPABILITY);
        Validated validated = validate(workspaceId, input);
        Instant now = clock.instant();
        AlertRule rule = new AlertRule(UUID.randomUUID(), workspaceId, input.workflowId(), validated.name(),
                input.type(), input.threshold(), validated.windowMinutes(), validated.cooldownMinutes(),
                input.enabled() == null || input.enabled(), actorId, now, now);
        if (!store.insertIfBelowLimit(rule, MAX_RULES_PER_WORKSPACE)) {
            throw new ConflictException("A workspace can have at most " + MAX_RULES_PER_WORKSPACE + " alert rules");
        }
        return rule;
    }

    public AlertRule update(UUID workspaceId, UUID actorId, UUID ruleId, RuleInput input) {
        workspaceAuthorization.require(workspaceId, actorId, EDIT_CAPABILITY);
        AlertRule existing = store.find(workspaceId, ruleId)
                .orElseThrow(() -> new ResourceNotFoundException("Alert rule", ruleId));
        Validated validated = validate(workspaceId, input);
        AlertRule rule = new AlertRule(existing.id(), workspaceId, input.workflowId(), validated.name(),
                input.type(), input.threshold(), validated.windowMinutes(), validated.cooldownMinutes(),
                input.enabled() == null ? existing.enabled() : input.enabled(), existing.createdBy(),
                existing.createdAt(), clock.instant());
        if (!store.update(rule)) {
            throw new ResourceNotFoundException("Alert rule", ruleId);
        }
        return rule;
    }

    public void delete(UUID workspaceId, UUID actorId, UUID ruleId) {
        workspaceAuthorization.require(workspaceId, actorId, EDIT_CAPABILITY);
        if (!store.delete(workspaceId, ruleId)) {
            throw new ResourceNotFoundException("Alert rule", ruleId);
        }
    }

    private Validated validate(UUID workspaceId, RuleInput input) {
        if (input == null || input.type() == null) {
            throw new BadRequestException("Alert rule type is required");
        }
        String name = input.name() == null ? "" : input.name().strip();
        if (name.isEmpty() || name.length() > 120) {
            throw new BadRequestException("Alert rule name must be 1 to 120 characters");
        }
        int cooldown = input.cooldownMinutes() == null ? DEFAULT_COOLDOWN_MINUTES : input.cooldownMinutes();
        if (cooldown < 0 || cooldown > 10_080) {
            throw new BadRequestException("cooldownMinutes must be between 0 and 10080");
        }
        Integer window = null;
        if (input.type() == AlertRuleType.CONSECUTIVE_FAILURES) {
            if (input.threshold() < 1 || input.threshold() > 20) {
                throw new BadRequestException("threshold must be between 1 and 20 failures");
            }
            window = input.windowMinutes();
            if (window == null || window < 1 || window > 10_080) {
                throw new BadRequestException("windowMinutes must be between 1 and 10080");
            }
        } else {
            if (input.threshold() < 1 || input.threshold() > 86_400) {
                throw new BadRequestException("threshold must be between 1 and 86400 seconds");
            }
            if (input.windowMinutes() != null) {
                throw new BadRequestException("windowMinutes only applies to CONSECUTIVE_FAILURES rules");
            }
        }
        if (input.workflowId() != null && !store.workflowInWorkspace(workspaceId, input.workflowId())) {
            throw new BadRequestException("The workflow does not exist in this workspace");
        }
        return new Validated(name, window, cooldown);
    }

    public record RuleInput(String name, AlertRuleType type, UUID workflowId, int threshold,
                            Integer windowMinutes, Integer cooldownMinutes, Boolean enabled) {
    }

    private record Validated(String name, Integer windowMinutes, int cooldownMinutes) {
    }
}
