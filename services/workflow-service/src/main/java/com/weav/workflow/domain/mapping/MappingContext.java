package com.weav.workflow.domain.mapping;

import com.weav.workflow.domain.definition.JsonValues;

import java.util.Map;

/** Immutable runtime values available to a mapping expression. {@code run} is null outside a run. */
public record MappingContext(
        Object triggerInput,
        Map<String, Object> outputs,
        Map<String, Object> variables,
        RunInfo run) {

    public MappingContext {
        triggerInput = JsonValues.freeze(triggerInput);
        outputs = JsonValues.freezeMap(outputs);
        variables = JsonValues.freezeMap(variables);
    }

    /** Without run information: {@code now}, {@code run.*} and {@code workflow.*} are then unavailable. */
    public MappingContext(Object triggerInput, Map<String, Object> outputs, Map<String, Object> variables) {
        this(triggerInput, outputs, variables, null);
    }
}
