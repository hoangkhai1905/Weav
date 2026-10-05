package com.weav.workflow.domain.execution;

import com.weav.workflow.domain.definition.WorkflowDefinition;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static com.weav.workflow.domain.execution.GraphState.EdgeState.ACTIVE;
import static com.weav.workflow.domain.execution.GraphState.EdgeState.INACTIVE;
import static com.weav.workflow.domain.execution.GraphState.EdgeState.UNKNOWN;
import static com.weav.workflow.domain.valueobject.NodeExecutionStatus.PENDING;
import static com.weav.workflow.domain.valueobject.NodeExecutionStatus.READY;
import static com.weav.workflow.domain.valueobject.NodeExecutionStatus.SKIPPED;
import static com.weav.workflow.domain.valueobject.NodeExecutionStatus.SUCCESS;
import static org.junit.jupiter.api.Assertions.assertEquals;

class ReadinessPlannerTest {
    private final ReadinessPlanner planner = new ReadinessPlanner();

    @Test
    void initializesAManualRootAsSuccessfulAndMakesItsFirstNodeReadyOnlyOnce() {
        WorkflowDefinition definition = workflow(
                manual("manual"), action("request"),
                edge("manual-request", "manual", "request"));

        GraphState state = planner.initialize(definition, "manual");

        assertEquals(SUCCESS, state.nodes().get("manual"));
        assertEquals(PENDING, state.nodes().get("request"));
        assertEquals(ACTIVE, state.edges().get("manual-request"));
        assertEquals(List.of("request"), planner.ready(definition, state));
        assertEquals(READY, state.nodes().get("request"));
        assertEquals(List.of(), planner.ready(definition, state));
    }

    @Test
    void excludesOtherTriggerRootsAndDoesNotWaitForTheirInactiveJoinRoutes() {
        WorkflowDefinition definition = workflow(
                manual("manual"), webhook("webhook"), action("manual-action"),
                action("webhook-action"), action("join"),
                edge("manual-route", "manual", "manual-action"),
                edge("webhook-route", "webhook", "webhook-action"),
                edge("manual-join", "manual-action", "join"),
                edge("webhook-join", "webhook-action", "join"));

        GraphState state = planner.initialize(definition, "manual");

        assertEquals(SKIPPED, state.nodes().get("webhook"));
        assertEquals(PENDING, state.nodes().get("webhook-action"));
        assertEquals(ACTIVE, state.edges().get("manual-route"));
        assertEquals(INACTIVE, state.edges().get("webhook-route"));
        assertEquals(UNKNOWN, state.edges().get("manual-join"));
        assertEquals(List.of("manual-action"), planner.ready(definition, state));
        assertEquals(SKIPPED, state.nodes().get("webhook-action"));
        assertEquals(INACTIVE, state.edges().get("webhook-join"));
        assertEquals(PENDING, state.nodes().get("join"));

        GraphState afterAction = planner.afterSuccess(definition, state, "manual-action", null);
        assertEquals(ACTIVE, afterAction.edges().get("manual-join"));
        assertEquals(List.of("join"), planner.ready(definition, afterAction));
        assertEquals(List.of(), planner.ready(definition, afterAction));
    }

    @Test
    void waitsForEveryActiveDiamondPredecessorWhenTheyFinishInReverseOrder() {
        WorkflowDefinition definition = workflow(
                manual("manual"), action("left"), action("right"), action("join"),
                edge("to-left", "manual", "left"),
                edge("to-right", "manual", "right"),
                edge("left-join", "left", "join"),
                edge("right-join", "right", "join"));
        GraphState state = planner.initialize(definition, "manual");

        assertEquals(List.of("left", "right"), planner.ready(definition, state));
        GraphState afterRight = planner.afterSuccess(definition, state, "right", null);
        assertEquals(List.of(), planner.ready(definition, afterRight));
        assertEquals(PENDING, afterRight.nodes().get("join"));

        GraphState afterLeft = planner.afterSuccess(definition, afterRight, "left", null);
        assertEquals(List.of("join"), planner.ready(definition, afterLeft));
        assertEquals(READY, afterLeft.nodes().get("join"));
        assertEquals(List.of(), planner.ready(definition, afterLeft));
    }

    @Test
    void activatesOnlyTheSelectedConditionPortAndWaitsOnlyForThatJoinRoute() {
        WorkflowDefinition definition = workflow(
                manual("manual"), condition("condition"), action("selected"),
                action("unselected"), action("join"),
                edge("manual-condition", "manual", "condition"),
                branch("condition-true", "condition", "selected", "true"),
                branch("condition-false", "condition", "unselected", "false"),
                edge("selected-join", "selected", "join"),
                edge("unselected-join", "unselected", "join"));
        GraphState initial = planner.initialize(definition, "manual");

        assertEquals(List.of("condition"), planner.ready(definition, initial));
        GraphState afterCondition = planner.afterSuccess(definition, initial, "condition", "true");
        assertEquals(ACTIVE, afterCondition.edges().get("condition-true"));
        assertEquals(INACTIVE, afterCondition.edges().get("condition-false"));
        assertEquals(List.of("selected"), planner.ready(definition, afterCondition));
        assertEquals(SKIPPED, afterCondition.nodes().get("unselected"));
        assertEquals(INACTIVE, afterCondition.edges().get("unselected-join"));
        assertEquals(PENDING, afterCondition.nodes().get("join"));

        GraphState afterSelected = planner.afterSuccess(definition, afterCondition, "selected", null);
        assertEquals(List.of("join"), planner.ready(definition, afterSelected));
        assertEquals(List.of(), planner.ready(definition, afterSelected));
    }

    @Test
    void nestedConditionsPropagateTheChosenSubgraphAndPreserveMixedJoinPaths() {
        WorkflowDefinition definition = workflow(
                manual("manual"), condition("outer"), condition("inner"),
                action("outer-false"), action("inner-true"), action("inner-false"), action("join"),
                edge("manual-outer", "manual", "outer"),
                branch("outer-true", "outer", "inner", "true"),
                branch("outer-false-route", "outer", "outer-false", "false"),
                branch("inner-true-route", "inner", "inner-true", "true"),
                branch("inner-false-route", "inner", "inner-false", "false"),
                edge("true-join", "inner-true", "join"),
                edge("false-join", "inner-false", "join"),
                edge("outer-false-join", "outer-false", "join"));
        GraphState initial = planner.initialize(definition, "manual");

        assertEquals(List.of("outer"), planner.ready(definition, initial));
        GraphState afterOuter = planner.afterSuccess(definition, initial, "outer", "true");
        assertEquals(List.of("inner"), planner.ready(definition, afterOuter));
        assertEquals(SKIPPED, afterOuter.nodes().get("outer-false"));

        GraphState afterInner = planner.afterSuccess(definition, afterOuter, "inner", "false");
        assertEquals(List.of("inner-false"), planner.ready(definition, afterInner));
        assertEquals(SKIPPED, afterInner.nodes().get("inner-true"));
        assertEquals(INACTIVE, afterInner.edges().get("true-join"));
        assertEquals(INACTIVE, afterInner.edges().get("outer-false-join"));
        assertEquals(PENDING, afterInner.nodes().get("join"));

        GraphState afterFalse = planner.afterSuccess(definition, afterInner, "inner-false", null);
        assertEquals(List.of("join"), planner.ready(definition, afterFalse));
    }

    @Test
    void anInactiveConditionSubtreeAndItsAllInactiveJoinBecomeSkipped() {
        WorkflowDefinition definition = workflow(
                manual("manual"), condition("outer"), condition("nested"),
                action("outer-false"), action("nested-true"), action("nested-false"), action("inactive-join"),
                edge("manual-outer", "manual", "outer"),
                branch("outer-true", "outer", "nested", "true"),
                branch("outer-false-route", "outer", "outer-false", "false"),
                branch("nested-true-route", "nested", "nested-true", "true"),
                branch("nested-false-route", "nested", "nested-false", "false"),
                edge("nested-true-join", "nested-true", "inactive-join"),
                edge("nested-false-join", "nested-false", "inactive-join"));
        GraphState initial = planner.initialize(definition, "manual");

        assertEquals(List.of("outer"), planner.ready(definition, initial));
        GraphState afterOuter = planner.afterSuccess(definition, initial, "outer", "false");
        assertEquals(List.of("outer-false"), planner.ready(definition, afterOuter));
        assertEquals(SKIPPED, afterOuter.nodes().get("nested"));
        assertEquals(SKIPPED, afterOuter.nodes().get("nested-true"));
        assertEquals(SKIPPED, afterOuter.nodes().get("nested-false"));
        assertEquals(SKIPPED, afterOuter.nodes().get("inactive-join"));
        assertEquals(INACTIVE, afterOuter.edges().get("nested-true-join"));
        assertEquals(INACTIVE, afterOuter.edges().get("nested-false-join"));
    }

    @Test
    void activatesOnlyTheSelectedSwitchPortIncludingDefaultAndLeavesUnusedPortsHarmless() {
        WorkflowDefinition definition = workflow(
                manual("manual"), switchNode("switch"), action("gold"), action("silver"), action("other"),
                edge("manual-switch", "manual", "switch"),
                branch("switch-gold", "switch", "gold", "gold"),
                branch("switch-silver", "switch", "silver", "silver"),
                branch("switch-other", "switch", "other", "default"));
        GraphState initial = planner.initialize(definition, "manual");
        assertEquals(List.of("switch"), planner.ready(definition, initial));

        GraphState afterGold = planner.afterSuccess(definition, initial, "switch", "gold");
        assertEquals(ACTIVE, afterGold.edges().get("switch-gold"));
        assertEquals(INACTIVE, afterGold.edges().get("switch-silver"));
        assertEquals(INACTIVE, afterGold.edges().get("switch-other"));
        assertEquals(List.of("gold"), planner.ready(definition, afterGold));
        assertEquals(SKIPPED, afterGold.nodes().get("silver"));
        assertEquals(SKIPPED, afterGold.nodes().get("other"));

        // a port with no edge (here "bronze") leaves every edge inactive
        GraphState afterBronze = planner.afterSuccess(definition, initial, "switch", "bronze");
        assertEquals(List.of(), planner.ready(definition, afterBronze));
        assertEquals(SKIPPED, afterBronze.nodes().get("gold"));
        assertEquals(SKIPPED, afterBronze.nodes().get("other"));
    }

    @Test
    void twoSwitchPortsFeedingOneJoinLeaveOneActiveEdgeAndTheJoinStillRuns() {
        WorkflowDefinition definition = workflow(
                manual("manual"), switchNode("switch"), action("join"),
                edge("manual-switch", "manual", "switch"),
                branch("switch-join-a", "switch", "join", "a"),
                branch("switch-join-b", "switch", "join", "b"));
        GraphState initial = planner.initialize(definition, "manual");
        planner.ready(definition, initial);

        GraphState afterSwitch = planner.afterSuccess(definition, initial, "switch", "b");

        assertEquals(INACTIVE, afterSwitch.edges().get("switch-join-a"));
        assertEquals(ACTIVE, afterSwitch.edges().get("switch-join-b"));
        assertEquals(List.of("join"), planner.ready(definition, afterSwitch));
    }

    @Test
    void aSkippedSwitchMarksEveryPortEdgeInactive() {
        WorkflowDefinition definition = workflow(
                manual("manual"), condition("gate"), switchNode("switch"), action("a"), action("other"),
                edge("manual-gate", "manual", "gate"),
                branch("gate-switch", "gate", "switch", "true"),
                branch("switch-a", "switch", "a", "a"),
                branch("switch-other", "switch", "other", "default"));
        GraphState initial = planner.initialize(definition, "manual");
        planner.ready(definition, initial);

        GraphState afterGate = planner.afterSuccess(definition, initial, "gate", "false");
        planner.ready(definition, afterGate);

        assertEquals(SKIPPED, afterGate.nodes().get("switch"));
        assertEquals(INACTIVE, afterGate.edges().get("switch-a"));
        assertEquals(INACTIVE, afterGate.edges().get("switch-other"));
        assertEquals(SKIPPED, afterGate.nodes().get("a"));
        assertEquals(SKIPPED, afterGate.nodes().get("other"));
    }

    @Test
    void aSwitchMustSelectAPortAndEveryEdgeMustCarryOne() {
        WorkflowDefinition definition = workflow(
                manual("manual"), switchNode("switch"), action("next"),
                edge("manual-switch", "manual", "switch"), edge("switch-next", "switch", "next"));
        GraphState initial = planner.initialize(definition, "manual");
        planner.ready(definition, initial);

        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                () -> planner.afterSuccess(definition, initial, "switch", null));
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                () -> planner.afterSuccess(definition, initial, "switch", "gold"));
    }

    private static WorkflowDefinition workflow(Object... graphElements) {
        List<WorkflowDefinition.Node> nodes = new java.util.ArrayList<>();
        List<WorkflowDefinition.Edge> edges = new java.util.ArrayList<>();
        for (Object element : graphElements) {
            if (element instanceof WorkflowDefinition.Node node) {
                nodes.add(node);
            } else if (element instanceof WorkflowDefinition.Edge edge) {
                edges.add(edge);
            } else {
                throw new IllegalArgumentException("Graph fixture contains an unsupported element.");
            }
        }
        return new WorkflowDefinition("1.0", nodes, edges, Map.of());
    }

    private static WorkflowDefinition.Node manual(String id) {
        return new WorkflowDefinition.Node(id, "trigger.manual", Map.of());
    }

    private static WorkflowDefinition.Node webhook(String id) {
        return new WorkflowDefinition.Node(id, "trigger.webhook", Map.of());
    }

    private static WorkflowDefinition.Node action(String id) {
        return new WorkflowDefinition.Node(id, "http.request", Map.of());
    }

    private static WorkflowDefinition.Node condition(String id) {
        return new WorkflowDefinition.Node(id, "logic.condition", Map.of());
    }

    private static WorkflowDefinition.Node switchNode(String id) {
        return new WorkflowDefinition.Node(id, "logic.switch", Map.of());
    }

    private static WorkflowDefinition.Edge edge(String id, String source, String target) {
        return new WorkflowDefinition.Edge(id, source, target, null);
    }

    private static WorkflowDefinition.Edge branch(
            String id, String source, String target, String port) {
        return new WorkflowDefinition.Edge(id, source, target, port);
    }
}
