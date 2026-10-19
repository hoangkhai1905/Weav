package com.weav.workflow.presentation.http.response;

import com.weav.workflow.domain.model.aggregate.workflow.WorkflowSummary;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowSummary.Link;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowSummary.NodeRef;
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

    @Test
    void stepTypesFollowTheEdgesFromTheTriggersThenAppendUnreachedNodes() {
        List<NodeRef> nodes = List.of(
                new NodeRef("send", "email.send"),
                new NodeRef("hook", "trigger.webhook"),
                new NodeRef("orphan", "data.set"),
                new NodeRef("log", "data.set"),
                new NodeRef(null, "http.request"),
                new NodeRef("untyped", null));
        List<Link> links = List.of(
                new Link("hook", "log"),
                new Link("log", "send"),
                new Link("send", "log"),
                new Link("log", "missing"),
                new Link(null, "orphan"));

        assertEquals(List.of("data.set", "email.send", "data.set", "http.request"),
                WorkflowSummary.stepTypes(nodes, links));
        assertEquals(List.of(), WorkflowSummary.stepTypes(List.of(), List.of()));
    }
}
