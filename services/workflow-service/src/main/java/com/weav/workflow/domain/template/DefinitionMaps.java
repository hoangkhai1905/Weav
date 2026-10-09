package com.weav.workflow.domain.template;

import com.weav.workflow.domain.definition.WorkflowDefinition;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Converts between the stored JSON-map form of a workflow definition and the pure record. */
public final class DefinitionMaps {
    private DefinitionMaps() {
    }

    /** Lenient about an absent edges/variables section, strict about the shape of what is present. */
    public static WorkflowDefinition toDefinition(Map<String, Object> source) {
        Object version = source.get("schemaVersion");
        List<WorkflowDefinition.Node> nodes = new ArrayList<>();
        for (Object item : list(source.get("nodes"))) {
            Map<?, ?> node = map(item);
            nodes.add(new WorkflowDefinition.Node(string(node.get("id")), string(node.get("type")), stringKeys(node.get("config"))));
        }
        List<WorkflowDefinition.Edge> edges = new ArrayList<>();
        for (Object item : list(source.get("edges"))) {
            Map<?, ?> edge = map(item);
            Object port = edge.get("sourcePort");
            edges.add(new WorkflowDefinition.Edge(string(edge.get("id")), string(edge.get("source")),
                    string(edge.get("target")), port == null ? null : string(port)));
        }
        Object variables = source.get("variables");
        return new WorkflowDefinition(version == null ? "1.0" : string(version), nodes, edges,
                variables == null ? Map.of() : stringKeys(variables));
    }

    public static Map<String, Object> toMap(WorkflowDefinition definition) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("schemaVersion", definition.schemaVersion());
        List<Object> nodes = new ArrayList<>();
        for (WorkflowDefinition.Node node : definition.nodes()) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", node.id());
            item.put("type", node.type());
            item.put("config", node.config());
            nodes.add(item);
        }
        result.put("nodes", nodes);
        List<Object> edges = new ArrayList<>();
        for (WorkflowDefinition.Edge edge : definition.edges()) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", edge.id());
            item.put("source", edge.source());
            item.put("target", edge.target());
            item.put("sourcePort", edge.sourcePort());
            edges.add(item);
        }
        result.put("edges", edges);
        result.put("variables", definition.variables());
        return result;
    }

    private static List<?> list(Object value) {
        if (value == null) {
            return List.of();
        }
        if (value instanceof List<?> list) {
            return list;
        }
        throw new IllegalArgumentException("A workflow definition list was expected");
    }

    private static Map<?, ?> map(Object value) {
        if (value instanceof Map<?, ?> map) {
            return map;
        }
        throw new IllegalArgumentException("A workflow definition object was expected");
    }

    private static Map<String, Object> stringKeys(Object value) {
        Map<String, Object> result = new LinkedHashMap<>();
        map(value).forEach((key, item) -> result.put(string(key), item));
        return result;
    }

    private static String string(Object value) {
        if (value instanceof String text) {
            return text;
        }
        throw new IllegalArgumentException("A workflow definition string was expected");
    }
}
