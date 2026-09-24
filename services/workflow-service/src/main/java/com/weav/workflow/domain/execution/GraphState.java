package com.weav.workflow.domain.execution;

import com.weav.workflow.domain.valueobject.NodeExecutionStatus;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/** Status-only in-memory state for one workflow graph execution. */
public final class GraphState {
    private final Map<String, NodeExecutionStatus> nodes;
    private final Map<String, EdgeState> edges;

    public GraphState(Map<String, NodeExecutionStatus> nodes, Map<String, EdgeState> edges) {
        this.nodes = copyNodes(nodes);
        this.edges = copyEdges(edges);
    }

    /** Returns a read-only view of node statuses; trigger input and node outputs live in the execution snapshot. */
    public Map<String, NodeExecutionStatus> nodes() {
        return Collections.unmodifiableMap(nodes);
    }

    /** Returns a read-only view of edge activity. */
    public Map<String, EdgeState> edges() {
        return Collections.unmodifiableMap(edges);
    }

    void setNodeStatus(String nodeId, NodeExecutionStatus status) {
        if (!nodes.containsKey(nodeId)) {
            throw new IllegalArgumentException("Graph state does not contain the node.");
        }
        nodes.put(nodeId, Objects.requireNonNull(status, "status"));
    }

    void setEdgeState(String edgeId, EdgeState state) {
        if (!edges.containsKey(edgeId)) {
            throw new IllegalArgumentException("Graph state does not contain the edge.");
        }
        edges.put(edgeId, Objects.requireNonNull(state, "state"));
    }

    private static Map<String, NodeExecutionStatus> copyNodes(Map<String, NodeExecutionStatus> source) {
        Objects.requireNonNull(source, "nodes");
        Map<String, NodeExecutionStatus> copy = new LinkedHashMap<>();
        source.forEach((id, status) -> copy.put(
                Objects.requireNonNull(id, "node id"), Objects.requireNonNull(status, "node status")));
        return copy;
    }

    private static Map<String, EdgeState> copyEdges(Map<String, EdgeState> source) {
        Objects.requireNonNull(source, "edges");
        Map<String, EdgeState> copy = new LinkedHashMap<>();
        source.forEach((id, state) -> copy.put(
                Objects.requireNonNull(id, "edge id"), Objects.requireNonNull(state, "edge state")));
        return copy;
    }

    public enum EdgeState {
        UNKNOWN,
        ACTIVE,
        INACTIVE
    }
}
