package com.weav.workflow.domain.execution;

import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.valueobject.NodeExecutionStatus;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import static com.weav.workflow.domain.execution.GraphState.EdgeState.ACTIVE;
import static com.weav.workflow.domain.execution.GraphState.EdgeState.INACTIVE;
import static com.weav.workflow.domain.execution.GraphState.EdgeState.UNKNOWN;
import static com.weav.workflow.domain.valueobject.NodeExecutionStatus.PENDING;
import static com.weav.workflow.domain.valueobject.NodeExecutionStatus.READY;
import static com.weav.workflow.domain.valueobject.NodeExecutionStatus.RUNNING;
import static com.weav.workflow.domain.valueobject.NodeExecutionStatus.SKIPPED;
import static com.weav.workflow.domain.valueobject.NodeExecutionStatus.SUCCESS;

/** Plans DAG readiness using only the execution's node and edge statuses. */
public final class ReadinessPlanner {
    private static final String CONDITION_TYPE = "logic.condition";
    private static final Set<String> CONDITION_PORTS = Set.of("true", "false");

    public GraphState initialize(WorkflowDefinition definition, String firingRoot) {
        GraphIndex index = index(definition);
        WorkflowDefinition.Node activeRoot = index.nodesById().get(firingRoot);
        if (activeRoot == null || !isTrigger(activeRoot)) {
            throw new IllegalArgumentException("The firing root must be a trigger node in the definition.");
        }
        if (!index.incoming().get(firingRoot).isEmpty()) {
            throw new IllegalArgumentException("Trigger roots cannot have incoming edges.");
        }

        Map<String, NodeExecutionStatus> nodeStatuses = new LinkedHashMap<>();
        index.nodesById().forEach((nodeId, node) -> {
            if (isTrigger(node)) {
                if (!index.incoming().get(nodeId).isEmpty()) {
                    throw new IllegalArgumentException("Trigger roots cannot have incoming edges.");
                }
                nodeStatuses.put(nodeId, nodeId.equals(firingRoot) ? SUCCESS : SKIPPED);
            } else {
                nodeStatuses.put(nodeId, PENDING);
            }
        });

        Map<String, GraphState.EdgeState> edgeStates = new LinkedHashMap<>();
        index.edgesById().keySet().forEach(edgeId -> edgeStates.put(edgeId, UNKNOWN));
        index.nodesById().forEach((nodeId, node) -> {
            if (isTrigger(node)) {
                GraphState.EdgeState state = nodeId.equals(firingRoot) ? ACTIVE : INACTIVE;
                index.outgoing().get(nodeId).forEach(edge -> edgeStates.put(edge.id(), state));
            }
        });

        return new GraphState(nodeStatuses, edgeStates);
    }

    /**
     * Marks each newly runnable node READY and propagates branch exclusions to a fixed point.
     * Node transitions are kept in GraphState so repeated calls cannot schedule a node twice.
     */
    public List<String> ready(WorkflowDefinition definition, GraphState graphState) {
        GraphIndex index = index(definition);
        requireCompatible(index, graphState);
        List<String> newlyReady = new ArrayList<>();
        boolean changed;
        do {
            changed = false;
            for (String nodeId : index.topologicalOrder()) {
                if (graphState.nodes().get(nodeId) != PENDING) {
                    continue;
                }

                List<WorkflowDefinition.Edge> incoming = index.incoming().get(nodeId);
                boolean hasUnknownIncoming = incoming.stream()
                        .anyMatch(edge -> graphState.edges().get(edge.id()) == UNKNOWN);
                if (hasUnknownIncoming) {
                    continue;
                }

                List<WorkflowDefinition.Edge> activeIncoming = incoming.stream()
                        .filter(edge -> graphState.edges().get(edge.id()) == ACTIVE)
                        .toList();
                if (activeIncoming.isEmpty()) {
                    graphState.setNodeStatus(nodeId, SKIPPED);
                    markOutgoingInactive(index, graphState, nodeId);
                    changed = true;
                    continue;
                }

                boolean everyActivePredecessorSucceeded = activeIncoming.stream()
                        .allMatch(edge -> graphState.nodes().get(edge.source()) == SUCCESS);
                if (everyActivePredecessorSucceeded) {
                    graphState.setNodeStatus(nodeId, READY);
                    newlyReady.add(nodeId);
                    changed = true;
                }
            }
        } while (changed);

        return List.copyOf(newlyReady);
    }

    public GraphState afterSuccess(
            WorkflowDefinition definition, GraphState graphState, String nodeId, String selectedPort) {
        GraphIndex index = index(definition);
        requireCompatible(index, graphState);
        WorkflowDefinition.Node node = index.nodesById().get(nodeId);
        if (node == null) {
            throw new IllegalArgumentException("The completed node is not in the definition.");
        }

        Map<String, GraphState.EdgeState> outgoingStates = outgoingStates(index, node, selectedPort);
        NodeExecutionStatus currentStatus = graphState.nodes().get(nodeId);
        if (currentStatus == SUCCESS) {
            outgoingStates.forEach((edgeId, expected) -> {
                if (graphState.edges().get(edgeId) != expected) {
                    throw new IllegalArgumentException("A successful node cannot change its selected routes.");
                }
            });
            return graphState;
        }
        if (currentStatus != READY && currentStatus != RUNNING) {
            throw new IllegalArgumentException("Only a READY or RUNNING node can complete successfully.");
        }

        Map<String, NodeExecutionStatus> nodeStatuses = new LinkedHashMap<>(graphState.nodes());
        nodeStatuses.put(nodeId, SUCCESS);
        Map<String, GraphState.EdgeState> edgeStates = new LinkedHashMap<>(graphState.edges());
        edgeStates.putAll(outgoingStates);
        return new GraphState(nodeStatuses, edgeStates);
    }

    private Map<String, GraphState.EdgeState> outgoingStates(
            GraphIndex index, WorkflowDefinition.Node node, String selectedPort) {
        List<WorkflowDefinition.Edge> outgoing = index.outgoing().get(node.id());
        Map<String, GraphState.EdgeState> states = new LinkedHashMap<>();
        if (CONDITION_TYPE.equals(node.type())) {
            if (selectedPort == null || !CONDITION_PORTS.contains(selectedPort)) {
                throw new IllegalArgumentException("A condition must select the true or false port.");
            }
            for (WorkflowDefinition.Edge edge : outgoing) {
                if (edge.sourcePort() == null || !CONDITION_PORTS.contains(edge.sourcePort())) {
                    throw new IllegalArgumentException("Condition edges must use a true or false source port.");
                }
                states.put(edge.id(), selectedPort.equals(edge.sourcePort()) ? ACTIVE : INACTIVE);
            }
            return states;
        }

        if (selectedPort != null) {
            throw new IllegalArgumentException("Only condition nodes may select an output port.");
        }
        for (WorkflowDefinition.Edge edge : outgoing) {
            if (edge.sourcePort() != null) {
                throw new IllegalArgumentException("Only condition edges may use a source port.");
            }
            states.put(edge.id(), ACTIVE);
        }
        return states;
    }

    private void markOutgoingInactive(GraphIndex index, GraphState graphState, String nodeId) {
        for (WorkflowDefinition.Edge edge : index.outgoing().get(nodeId)) {
            GraphState.EdgeState state = graphState.edges().get(edge.id());
            if (state == ACTIVE) {
                throw new IllegalArgumentException("A skipped node cannot have an active outgoing edge.");
            }
            if (state == UNKNOWN) {
                graphState.setEdgeState(edge.id(), INACTIVE);
            }
        }
    }

    private void requireCompatible(GraphIndex index, GraphState graphState) {
        Objects.requireNonNull(graphState, "graphState");
        if (!graphState.nodes().keySet().equals(index.nodesById().keySet())
                || !graphState.edges().keySet().equals(index.edgesById().keySet())) {
            throw new IllegalArgumentException("Graph state does not match the workflow definition.");
        }
    }

    private GraphIndex index(WorkflowDefinition definition) {
        Objects.requireNonNull(definition, "definition");
        Map<String, WorkflowDefinition.Node> nodesById = new LinkedHashMap<>();
        Map<String, List<WorkflowDefinition.Edge>> incoming = new LinkedHashMap<>();
        Map<String, List<WorkflowDefinition.Edge>> outgoing = new LinkedHashMap<>();
        Map<String, Integer> indegrees = new LinkedHashMap<>();

        for (WorkflowDefinition.Node node : definition.nodes()) {
            if (node == null || node.id() == null || node.id().isBlank()) {
                throw new IllegalArgumentException("Every graph node must have a nonblank identifier.");
            }
            if (nodesById.putIfAbsent(node.id(), node) != null) {
                throw new IllegalArgumentException("Graph node identifiers must be unique.");
            }
            incoming.put(node.id(), new ArrayList<>());
            outgoing.put(node.id(), new ArrayList<>());
            indegrees.put(node.id(), 0);
        }

        Map<String, WorkflowDefinition.Edge> edgesById = new LinkedHashMap<>();
        for (WorkflowDefinition.Edge edge : definition.edges()) {
            if (edge == null || edge.id() == null || edge.id().isBlank()
                    || edge.source() == null || edge.target() == null) {
                throw new IllegalArgumentException("Every graph edge must have an identifier and endpoints.");
            }
            if (edgesById.putIfAbsent(edge.id(), edge) != null) {
                throw new IllegalArgumentException("Graph edge identifiers must be unique.");
            }
            if (!nodesById.containsKey(edge.source()) || !nodesById.containsKey(edge.target())) {
                throw new IllegalArgumentException("Graph edges must reference nodes in the definition.");
            }
            incoming.get(edge.target()).add(edge);
            outgoing.get(edge.source()).add(edge);
            indegrees.compute(edge.target(), (ignored, degree) -> degree + 1);
        }

        Deque<String> readyNodes = new ArrayDeque<>();
        indegrees.forEach((nodeId, degree) -> {
            if (degree == 0) {
                readyNodes.addLast(nodeId);
            }
        });
        List<String> topologicalOrder = new ArrayList<>(nodesById.size());
        while (!readyNodes.isEmpty()) {
            String nodeId = readyNodes.removeFirst();
            topologicalOrder.add(nodeId);
            for (WorkflowDefinition.Edge edge : outgoing.get(nodeId)) {
                int remaining = indegrees.compute(edge.target(), (ignored, degree) -> degree - 1);
                if (remaining == 0) {
                    readyNodes.addLast(edge.target());
                }
            }
        }
        if (topologicalOrder.size() != nodesById.size()) {
            throw new IllegalArgumentException("Workflow definition must be acyclic.");
        }

        return new GraphIndex(nodesById, edgesById, immutableLists(incoming),
                immutableLists(outgoing), List.copyOf(topologicalOrder));
    }

    private static Map<String, List<WorkflowDefinition.Edge>> immutableLists(
            Map<String, List<WorkflowDefinition.Edge>> source) {
        Map<String, List<WorkflowDefinition.Edge>> copy = new LinkedHashMap<>();
        source.forEach((nodeId, edges) -> copy.put(nodeId, List.copyOf(edges)));
        return Map.copyOf(copy);
    }

    private static boolean isTrigger(WorkflowDefinition.Node node) {
        return node.type() != null && node.type().startsWith("trigger.");
    }

    private record GraphIndex(
            Map<String, WorkflowDefinition.Node> nodesById,
            Map<String, WorkflowDefinition.Edge> edgesById,
            Map<String, List<WorkflowDefinition.Edge>> incoming,
            Map<String, List<WorkflowDefinition.Edge>> outgoing,
            List<String> topologicalOrder) {
    }
}
