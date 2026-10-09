package com.weav.workflow.domain.template;

import com.weav.workflow.domain.definition.NodeCatalog;
import com.weav.workflow.domain.definition.NodeConfigSchema;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.exception.BadRequestException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Strips what must not leave a workspace when a workflow is shared as a template, driven by the node schemas:
 * connection references are removed, personal fields survive only as a pure mapping, variable values are blanked,
 * and the editor state keeps node names and positions. Free text cannot be sanitized automatically, so likely
 * e-mail addresses and tokens in it are reported as warnings for the owner to review (the text is left as is).
 */
public final class TemplateSanitizer {
    // One mapping PATH (node ids, dots, list indexes), never a quoted literal or other brace content.
    private static final Pattern PURE_EXPRESSION =
            Pattern.compile("^\\s*\\{\\{\\s*[\\p{L}\\p{N}_$.\\[\\]-]+\\s*}}\\s*$");
    private static final Pattern EXPRESSION_SPAN = Pattern.compile("\\{\\{[^{}]*}}");
    private static final Pattern EMAIL = Pattern.compile("[^\\s@]+@[^\\s@]+\\.[^\\s@]+");
    private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9_-]{24,}");

    public SanitizedTemplate sanitize(WorkflowDefinition definition, Map<String, Object> editorState) {
        List<RemovedField> removed = new ArrayList<>();
        Set<TemplateWarning> warnings = new LinkedHashSet<>();
        List<WorkflowDefinition.Node> nodes = new ArrayList<>(definition.nodes().size());
        for (WorkflowDefinition.Node node : definition.nodes()) {
            nodes.add(node == null ? null : sanitizeNode(node, removed, warnings));
        }
        Map<String, Object> variables = new LinkedHashMap<>();
        definition.variables().keySet().forEach(key -> variables.put(key, ""));
        WorkflowDefinition sanitized = new WorkflowDefinition(
                definition.schemaVersion(), nodes, definition.edges(), variables);
        return new SanitizedTemplate(sanitized, sanitizeEditorState(editorState), List.copyOf(removed),
                List.copyOf(warnings));
    }

    private WorkflowDefinition.Node sanitizeNode(WorkflowDefinition.Node node, List<RemovedField> removed,
                                                 Set<TemplateWarning> warnings) {
        NodeConfigSchema schema = NodeCatalog.schema(node.type());
        if (schema == null) {
            // Fail closed: without a schema we cannot tell which fields are personal.
            throw new BadRequestException("TEMPLATE_NODE_NOT_SHAREABLE",
                    "Node " + node.id() + " has an unsupported type and cannot be shared in a template");
        }
        Set<String> connection = schema.connectionFields();
        Set<String> personal = schema.personalFields();
        Map<String, Object> config = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : node.config().entrySet()) {
            String field = entry.getKey();
            Object value = entry.getValue();
            if (connection.contains(field) || personal.contains(field) && !isPureExpression(value)) {
                removed.add(new RemovedField(node.id(), field));
                continue;
            }
            config.put(field, value);
            scan(value, node.id(), field, warnings);
        }
        return new WorkflowDefinition.Node(node.id(), node.type(), config);
    }

    /** One mapping expression, or a list whose items each are. */
    private static boolean isPureExpression(Object value) {
        if (value instanceof String text) {
            return PURE_EXPRESSION.matcher(text).matches();
        }
        return value instanceof List<?> list && list.stream().allMatch(TemplateSanitizer::isPureExpression);
    }

    private static void scan(Object value, String nodeId, String field, Set<TemplateWarning> warnings) {
        if (value instanceof String text) {
            String literal = EXPRESSION_SPAN.matcher(text).replaceAll(" ");
            if (EMAIL.matcher(literal).find()) {
                warnings.add(new TemplateWarning(nodeId, field, "EMAIL"));
            }
            if (TOKEN.matcher(literal).find()) {
                warnings.add(new TemplateWarning(nodeId, field, "TOKEN"));
            }
        } else if (value instanceof Map<?, ?> map) {
            map.values().forEach(item -> scan(item, nodeId, field, warnings));
        } else if (value instanceof List<?> list) {
            list.forEach(item -> scan(item, nodeId, field, warnings));
        }
    }

    private static Map<String, Object> sanitizeEditorState(Map<String, Object> editorState) {
        if (editorState == null) {
            return null;
        }
        Map<String, Object> nodes = new LinkedHashMap<>();
        if (editorState.get("nodes") instanceof Map<?, ?> source) {
            source.forEach((id, value) -> {
                if (id instanceof String key && value instanceof Map<?, ?> state) {
                    Map<String, Object> kept = new LinkedHashMap<>();
                    if (state.containsKey("name")) {
                        kept.put("name", state.get("name"));
                    }
                    if (state.get("position") instanceof Map<?, ?> position) {
                        Map<String, Object> xy = new LinkedHashMap<>();
                        for (String axis : List.of("x", "y")) {
                            if (position.get(axis) instanceof Number number) {
                                xy.put(axis, number);
                            }
                        }
                        kept.put("position", xy);
                    }
                    nodes.put(key, kept);
                }
            });
        }
        return Map.of("nodes", nodes);
    }

    public record SanitizedTemplate(WorkflowDefinition definition, Map<String, Object> editorState,
                                    List<RemovedField> removedFields, List<TemplateWarning> warnings) {
    }

    public record RemovedField(String nodeId, String field) {
    }

    /** {@code reason} is EMAIL or TOKEN. */
    public record TemplateWarning(String nodeId, String field, String reason) {
    }
}
