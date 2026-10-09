package com.weav.workflow.presentation.http.response;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class WorkflowResponseTest {

    @Test
    void summaryListsEveryTriggerTypeInDefinitionOrder() {
        Map<String, Object> definition = Map.of("nodes", List.of(
                Map.of("id", "send", "type", "email.send"),
                Map.of("id", "hook", "type", "trigger.webhook"),
                Map.of("id", "manual", "type", "trigger.manual")));

        assertEquals(List.of("trigger.webhook", "trigger.manual"), WorkflowResponse.Summary.triggerTypes(definition));
        assertEquals(List.of(), WorkflowResponse.Summary.triggerTypes(Map.of()));
        assertEquals(List.of(), WorkflowResponse.Summary.triggerTypes(null));
    }
}
