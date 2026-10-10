package com.weav.workflow.presentation.http.request;

import com.weav.workflow.application.service.AlertRuleService;
import com.weav.workflow.domain.valueobject.AlertRuleType;

import java.util.UUID;

/** Body of POST/PUT /alert-rules. Thresholds are range-checked by the service, which owns the limits. */
public record AlertRuleRequest(
        String name,
        AlertRuleType type,
        UUID workflowId,
        Integer threshold,
        Integer windowMinutes,
        Integer cooldownMinutes,
        Boolean enabled
) {
    public AlertRuleService.RuleInput toInput() {
        return new AlertRuleService.RuleInput(name, type, workflowId, threshold == null ? 0 : threshold,
                windowMinutes, cooldownMinutes, enabled);
    }
}
