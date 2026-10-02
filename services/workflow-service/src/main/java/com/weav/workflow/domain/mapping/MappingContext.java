package com.weav.workflow.domain.mapping;

import com.weav.workflow.domain.definition.JsonValues;

import java.util.Map;

/** Immutable runtime values available to a mapping expression. */
public record MappingContext(
        Object triggerInput,
        Map<String, Object> outputs,
        Map<String, Object> variables) {

    public MappingContext {
        triggerInput = JsonValues.freeze(triggerInput);
        outputs = JsonValues.freezeMap(outputs);
        variables = JsonValues.freezeMap(variables);
    }
}
