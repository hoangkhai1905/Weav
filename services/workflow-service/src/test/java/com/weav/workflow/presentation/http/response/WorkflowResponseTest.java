package com.weav.workflow.presentation.http.response;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class WorkflowResponseTest {

    @Test
    void summaryListsEveryTriggerTypeInDefinitionOrder() {
        assertEquals(List.of("trigger.webhook", "trigger.manual"), WorkflowResponse.Summary.triggerTypes(
                List.of("email.send", "trigger.webhook", "trigger.manual")));
        assertEquals(List.of(), WorkflowResponse.Summary.triggerTypes(List.of()));
    }
}
