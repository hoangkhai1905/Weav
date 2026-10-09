package com.weav.workflow.domain.generation;

import com.weav.workflow.domain.definition.DefinitionValidator;
import com.weav.workflow.domain.definition.NodeCatalog;
import com.weav.workflow.domain.definition.NodeConfigSchema;
import com.weav.workflow.domain.definition.ValidationIssue;
import com.weav.workflow.domain.definition.WorkflowDefinition;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Pattern;

/** Maps a WorkflowIntent 1:1 onto a WorkflowDefinition and reuses validatePublish as the only graph validator. */
public final class IntentCompiler {
    private static final Pattern NODE_ID = Pattern.compile("^[a-z][a-z0-9_]{0,31}$");
    private static final int MAX_STEP_NAME = 80;

    private final DefinitionValidator validator;

    public IntentCompiler(DefinitionValidator validator) {
        this.validator = Objects.requireNonNull(validator, "validator must not be null");
    }

    public sealed interface Compilation permits Ready, NeedsConnections, NeedsValues, Invalid {
    }

    /** {@code nodeNames}: the model's readable step titles by node id; only valid, non-blank ones. */
    public record Ready(String name, WorkflowDefinition definition, Map<String, Position> layout,
                        Map<String, String> nodeNames) implements Compilation {
        public Ready(String name, WorkflowDefinition definition, Map<String, Position> layout) {
            this(name, definition, layout, Map.of());
        }
    }

    public record NeedsConnections(List<String> nodeTypes) implements Compilation {
    }

    /** Required plain-text config values the user has to supply, one entry per node type and field. */
    public record NeedsValues(List<Missing> missing) implements Compilation {
    }

    public record Missing(String type, String field) {
    }

    public record Invalid() implements Compilation {
    }

    public record Position(int x, int y) {
    }

    public Compilation compile(Object intent, Map<String, UUID> connections) {
        return compile(intent, connections, Map.of());
    }

    /**
     * {@code answers} maps "&lt;nodeType&gt;.&lt;field&gt;" (or "&lt;nodeId&gt;.config.&lt;field&gt;") to a user-given value
     * that fills a config field the model left empty.
     */
    public Compilation compile(Object intent, Map<String, UUID> connections, Map<String, String> answers) {
        if (!(intent instanceof Map<?, ?> root) || !(root.get("name") instanceof String name)
                || name.isBlank() || name.codePointCount(0, name.length()) > 120
                || !(root.get("nodes") instanceof List<?> rawNodes) || rawNodes.size() < 2 || rawNodes.size() > 20
                || !(root.get("edges") instanceof List<?> rawEdges) || rawEdges.isEmpty() || rawEdges.size() > 40) {
            return new Invalid();
        }
        List<WorkflowDefinition.Node> nodes = new ArrayList<>();
        Map<String, String> nodeNames = new LinkedHashMap<>();
        for (Object raw : rawNodes) {
            if (!(raw instanceof Map<?, ?> node) || !(node.get("id") instanceof String id) || !NODE_ID.matcher(id).matches()
                    || !(node.get("type") instanceof String type) || !(node.get("config") instanceof Map<?, ?> rawConfig)
                    || rawConfig.containsKey("connectionId")) {
                return new Invalid();
            }
            Map<String, Object> config = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : rawConfig.entrySet()) {
                if (!(entry.getKey() instanceof String key)) {
                    return new Invalid();
                }
                config.put(key, entry.getValue());
            }
            fillAnswers(id, type, config, answers);
            UUID connection = connections.get(type);
            if (connection != null && NodeCatalog.configFields(type).contains("connectionId")) {
                config.put("connectionId", connection.toString());
            }
            nodes.add(new WorkflowDefinition.Node(id, type, config));
            if (node.get("name") instanceof String title && !title.isBlank()
                    && title.codePointCount(0, title.length()) <= MAX_STEP_NAME) {
                nodeNames.put(id, title.strip());
            }
        }
        List<WorkflowDefinition.Edge> edges = new ArrayList<>();
        for (int i = 0; i < rawEdges.size(); i++) {
            if (!(rawEdges.get(i) instanceof Map<?, ?> edge) || !(edge.get("from") instanceof String from)
                    || !(edge.get("to") instanceof String to)) {
                return new Invalid();
            }
            Object port = edge.get("port");
            if (port != null && !(port instanceof String)) {
                return new Invalid();
            }
            edges.add(new WorkflowDefinition.Edge("e" + (i + 1), from, to, (String) port));
        }

        WorkflowDefinition definition;
        try {
            definition = new WorkflowDefinition("1.0", nodes, edges, Map.of());
        } catch (IllegalArgumentException exception) {
            return new Invalid();
        }
        List<ValidationIssue> issues = validator.validatePublish(definition);
        if (!issues.isEmpty()) {
            Map<String, String> typeById = new HashMap<>();
            nodes.forEach(node -> typeById.put(node.id(), node.type()));
            Set<String> connectionTypes = new TreeSet<>();
            Set<Missing> values = new LinkedHashSet<>();
            for (ValidationIssue issue : issues) {
                String type = typeById.get(issue.nodeId());
                String field = issue.field() != null && issue.field().startsWith("config.")
                        ? issue.field().substring("config.".length()) : null;
                if (!"REQUIRED_FIELD_MISSING".equals(issue.code()) || type == null || field == null) {
                    return new Invalid();
                }
                if (field.equals("connectionId")) {
                    connectionTypes.add(type);
                } else if (askable(type, field) && values.size() < 10) {
                    values.add(new Missing(type, field));
                } else {
                    return new Invalid();
                }
            }
            // Values first: the connection question comes back on the next round, once the values are filled.
            return values.isEmpty() ? new NeedsConnections(List.copyOf(connectionTypes))
                    : new NeedsValues(List.copyOf(values));
        }
        return new Ready(name, definition, layout(nodes, edges), Map.copyOf(nodeNames));
    }

    private static void fillAnswers(String id, String type, Map<String, Object> config, Map<String, String> answers) {
        answers.forEach((key, value) -> {
            String field = key.startsWith(type + ".") ? key.substring(type.length() + 1)
                    : key.startsWith(id + ".config.") ? key.substring(id.length() + ".config.".length()) : null;
            if (field != null && !value.isBlank() && askable(type, field)
                    && (config.get(field) == null || config.get(field) instanceof String text && text.isBlank())) {
                config.put(field, value);
            }
        });
    }

    /** Only plain free-text fields can be answered in words (not enums, lists, objects or connections). */
    private static boolean askable(String type, String field) {
        if (!NodeCatalog.supports(type)) {
            return false;
        }
        NodeConfigSchema.Field property = NodeCatalog.schema(type).properties().get(field);
        return property != null && property.enumValues().isEmpty()
                && ("string".equals(property.type()) || property.oneOf().stream().anyMatch(branch -> "string".equals(branch.type())));
    }

    /** x = 100 + 300 × longest-path depth; y = 100 + 150 × order within that depth. The graph is already validated acyclic. */
    private static Map<String, Position> layout(List<WorkflowDefinition.Node> nodes, List<WorkflowDefinition.Edge> edges) {
        Map<String, Integer> depth = new HashMap<>();
        nodes.forEach(node -> depth.put(node.id(), 0));
        for (int pass = 0; pass < nodes.size(); pass++) {
            for (WorkflowDefinition.Edge edge : edges) {
                depth.merge(edge.target(), depth.get(edge.source()) + 1, Math::max);
            }
        }
        Map<Integer, Integer> rows = new HashMap<>();
        Map<String, Position> layout = new LinkedHashMap<>();
        for (WorkflowDefinition.Node node : nodes) {
            int column = depth.get(node.id());
            int row = rows.merge(column, 1, Integer::sum) - 1;
            layout.put(node.id(), new Position(100 + 300 * column, 100 + 150 * row));
        }
        return layout;
    }
}
