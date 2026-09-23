package com.weav.workflow.domain.definition;

import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;

/** Immutable, framework-independent representation of an editable workflow graph. */
public record WorkflowDefinition(
        String schemaVersion,
        List<Node> nodes,
        List<Edge> edges,
        Map<String, Object> variables) {

    public static final int MAX_JSON_DEPTH = 32;

    public WorkflowDefinition {
        nodes = immutableList(nodes);
        edges = immutableList(edges);
        variables = freezeMapWithinLimit(variables);
        checkDefinitionDepth(nodes, edges, variables);
    }

    private static <T> List<T> immutableList(List<T> source) {
        if (source == null || source.isEmpty()) {
            return List.of();
        }
        return Collections.unmodifiableList(new ArrayList<>(source));
    }

    private static Map<String, Object> freezeMapWithinLimit(Map<String, Object> source) {
        checkJsonDepth(source, 2, new IdentityHashMap<>());
        return JsonValues.freezeMap(source);
    }

    private static void checkJsonDepth(Object value) {
        checkJsonDepth(value, 1, new IdentityHashMap<>());
    }

    private static void checkDefinitionDepth(
            List<Node> nodes, List<Edge> edges, Map<String, Object> variables) {
        IdentityHashMap<Object, Boolean> activeContainers = new IdentityHashMap<>();
        checkJsonDepth(nodes, 2, activeContainers);
        checkJsonDepth(edges, 2, activeContainers);
        for (Node node : nodes) {
            if (node != null) {
                checkJsonDepth(node.config(), 4, activeContainers);
            }
        }
        checkJsonDepth(variables, 2, activeContainers);
    }

    private static void checkJsonDepth(Object value, int depth, IdentityHashMap<Object, Boolean> activeContainers) {
        if (!(value instanceof Map<?, ?>) && !(value instanceof List<?>)) {
            return;
        }
        if (depth > MAX_JSON_DEPTH) {
            throw new IllegalArgumentException("JSON value exceeds the maximum nesting depth");
        }
        if (activeContainers.put(value, Boolean.TRUE) != null) {
            throw new IllegalArgumentException("Cyclic containers are not valid JSON");
        }
        try {
            if (value instanceof Map<?, ?> object) {
                for (Map.Entry<?, ?> entry : object.entrySet()) {
                    checkJsonDepth(entry.getValue(), depth + 1, activeContainers);
                }
            } else if (value instanceof List<?> array) {
                for (Object item : array) {
                    checkJsonDepth(item, depth + 1, activeContainers);
                }
            }
        } finally {
            activeContainers.remove(value);
        }
    }

    /** A catalogued node and its immutable JSON configuration. */
    public record Node(String id, String type, Map<String, Object> config) {
        public Node {
            checkJsonDepth(config);
            config = JsonValues.freezeMap(config);
        }
    }

    /** A directed edge; only condition nodes use {@code sourcePort}. */
    public record Edge(String id, String source, String target, String sourcePort) {
    }
}
