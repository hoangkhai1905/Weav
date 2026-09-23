package com.weav.workflow.infrastructure.definition;

import com.weav.workflow.domain.definition.DefinitionValidator;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Converts bounded JSON documents to and from pure workflow definition records. */
public final class DefinitionJsonCodec {
    private static final Set<String> ENVELOPE_FIELDS = Set.of("schemaVersion", "nodes", "edges", "variables");
    private static final Set<String> NODE_FIELDS = Set.of("id", "type", "config");
    private static final Set<String> EDGE_FIELDS = Set.of("id", "source", "target", "sourcePort");

    private final ObjectMapper objectMapper;

    public DefinitionJsonCodec(ObjectMapper objectMapper) {
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
    }

    public WorkflowDefinition decode(JsonNode document) {
        if (document == null || !document.isObject()) {
            throw new IllegalArgumentException("A workflow definition must be a JSON object");
        }
        validateTreeDepth(document);
        validateDocumentSize(document);
        rejectUnknownFields(document, ENVELOPE_FIELDS);

        JsonNode schemaVersion = document.get("schemaVersion");
        JsonNode nodes = document.get("nodes");
        JsonNode edges = document.get("edges");
        JsonNode variables = document.get("variables");
        if (schemaVersion == null || !schemaVersion.isString()
                || nodes == null || !nodes.isArray()
                || edges == null || !edges.isArray()
                || variables != null && !variables.isObject()) {
            throw new IllegalArgumentException("The workflow definition envelope is malformed");
        }

        List<WorkflowDefinition.Node> decodedNodes = new ArrayList<>(nodes.size());
        for (JsonNode node : nodes) {
            if (node == null || !node.isObject()) {
                throw new IllegalArgumentException("Each workflow node must be an object");
            }
            rejectUnknownFields(node, NODE_FIELDS);
            JsonNode id = node.get("id");
            JsonNode type = node.get("type");
            JsonNode config = node.get("config");
            if (id == null || !id.isString() || type == null || !type.isString()
                    || config == null || !config.isObject()) {
                throw new IllegalArgumentException("A workflow node requires string identifiers and an object config");
            }
            decodedNodes.add(new WorkflowDefinition.Node(
                    id.stringValue(), type.stringValue(), objectMap(config)));
        }

        List<WorkflowDefinition.Edge> decodedEdges = new ArrayList<>(edges.size());
        for (JsonNode edge : edges) {
            if (edge == null || !edge.isObject()) {
                throw new IllegalArgumentException("Each workflow edge must be an object");
            }
            rejectUnknownFields(edge, EDGE_FIELDS);
            JsonNode id = edge.get("id");
            JsonNode source = edge.get("source");
            JsonNode target = edge.get("target");
            JsonNode sourcePort = edge.get("sourcePort");
            if (id == null || !id.isString() || source == null || !source.isString()
                    || target == null || !target.isString()
                    || sourcePort != null && !sourcePort.isString() && !sourcePort.isNull()) {
                throw new IllegalArgumentException("A workflow edge requires string identifiers and an optional string port");
            }
            decodedEdges.add(new WorkflowDefinition.Edge(
                    id.stringValue(), source.stringValue(), target.stringValue(),
                    sourcePort == null || sourcePort.isNull() ? null : sourcePort.stringValue()));
        }

        Map<String, Object> decodedVariables = variables == null ? Map.of() : objectMap(variables);
        return new WorkflowDefinition(schemaVersion.stringValue(), decodedNodes, decodedEdges, decodedVariables);
    }

    public JsonNode encode(WorkflowDefinition definition) {
        Objects.requireNonNull(definition, "definition");
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("schemaVersion", definition.schemaVersion());

        List<Object> nodes = new ArrayList<>(definition.nodes().size());
        for (WorkflowDefinition.Node node : definition.nodes()) {
            if (node == null) {
                nodes.add(null);
                continue;
            }
            Map<String, Object> serializedNode = new LinkedHashMap<>();
            serializedNode.put("id", node.id());
            serializedNode.put("type", node.type());
            serializedNode.put("config", node.config());
            nodes.add(serializedNode);
        }
        root.put("nodes", nodes);

        List<Object> edges = new ArrayList<>(definition.edges().size());
        for (WorkflowDefinition.Edge edge : definition.edges()) {
            if (edge == null) {
                edges.add(null);
                continue;
            }
            Map<String, Object> serializedEdge = new LinkedHashMap<>();
            serializedEdge.put("id", edge.id());
            serializedEdge.put("source", edge.source());
            serializedEdge.put("target", edge.target());
            serializedEdge.put("sourcePort", edge.sourcePort());
            edges.add(serializedEdge);
        }
        root.put("edges", edges);
        root.put("variables", definition.variables());
        return objectMapper.valueToTree(root);
    }

    private Map<String, Object> objectMap(JsonNode node) {
        if (!node.isObject()) {
            throw new IllegalArgumentException("A workflow JSON object was expected");
        }
        Map<String, Object> values = new LinkedHashMap<>();
        for (Map.Entry<String, JsonNode> property : node.properties()) {
            values.put(property.getKey(), jsonValue(property.getValue()));
        }
        return values;
    }

    private Object jsonValue(JsonNode node) {
        if (node.isNull()) {
            return null;
        }
        if (node.isString()) {
            return node.stringValue();
        }
        if (node.isBoolean()) {
            return node.booleanValue();
        }
        if (node.isNumber()) {
            return node.numberValue();
        }
        if (node.isArray()) {
            List<Object> values = new ArrayList<>(node.size());
            for (JsonNode item : node) {
                values.add(jsonValue(item));
            }
            return values;
        }
        if (node.isObject()) {
            return objectMap(node);
        }
        throw new IllegalArgumentException("The workflow definition contains a non-JSON value");
    }

    private void rejectUnknownFields(JsonNode object, Set<String> allowedFields) {
        Map<String, Object> properties = objectMap(object);
        if (properties.keySet().stream().anyMatch(field -> !allowedFields.contains(field))) {
            throw new IllegalArgumentException("The workflow definition contains an unsupported object field");
        }
    }

    private void validateDocumentSize(JsonNode document) {
        try {
            if (objectMapper.writeValueAsBytes(document).length > DefinitionValidator.MAX_DEFINITION_BYTES) {
                throw new IllegalArgumentException("The definition exceeds the supported size");
            }
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalArgumentException("The workflow definition could not be serialized safely", exception);
        }
    }

    private static void validateTreeDepth(JsonNode root) {
        Deque<DepthEntry> pending = new ArrayDeque<>();
        IdentityHashMap<JsonNode, Boolean> active = new IdentityHashMap<>();
        pending.addLast(new DepthEntry(root, 1, false));
        while (!pending.isEmpty()) {
            DepthEntry entry = pending.removeLast();
            JsonNode node = entry.node();
            if (entry.exit()) {
                active.remove(node);
                continue;
            }
            if (!node.isObject() && !node.isArray()) {
                continue;
            }
            if (entry.depth() > DefinitionValidator.MAX_JSON_DEPTH) {
                throw new IllegalArgumentException("The definition exceeds the supported JSON depth");
            }
            if (active.put(node, Boolean.TRUE) != null) {
                throw new IllegalArgumentException("Cyclic JSON trees are not supported");
            }
            pending.addLast(new DepthEntry(node, entry.depth(), true));
            for (JsonNode child : node) {
                pending.addLast(new DepthEntry(child, entry.depth() + 1, false));
            }
        }
    }

    private record DepthEntry(JsonNode node, int depth, boolean exit) {
    }
}
