package com.weav.workflow.domain.mapping;

import com.weav.workflow.domain.definition.JsonValues;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Resolves the bounded V1 mapping grammar without evaluating user code. */
public final class MappingResolver {
    private static final String NODE_ROOT = "nodes.";
    private static final String OUTPUT_MARKER = ".output";

    /**
     * Resolves a JSON value using trigger input, successful active-path outputs, and definition variables.
     * The caller supplies only outputs it is willing to expose to this node.
     */
    public Object resolve(Object value, MappingContext context) {
        return resolve(value, context, null, null);
    }

    /** Resolves a JSON value and attaches safe destination context to any mapping failure. */
    public Object resolve(Object value, MappingContext context, String destinationNodeId, String destinationField) {
        if (context == null) {
            throw new MappingException(destinationNodeId, destinationField, "A mapping context is required.");
        }
        try {
            return resolveValue(JsonValues.freeze(value), context, destinationNodeId, destinationField);
        } catch (MappingException exception) {
            throw exception.withContext(destinationNodeId, destinationField);
        } catch (IllegalArgumentException exception) {
            throw new MappingException(destinationNodeId, destinationField, "The mapping value is invalid.");
        }
    }

    /**
     * Extracts node references using the first {@code .output} marker when no graph is available.
     * Graph validation should call the overload with definition node IDs to disambiguate dotted IDs.
     */
    public Set<String> references(Object value) {
        return references(value, Set.of());
    }

    /**
     * Extracts referenced node IDs and uses known IDs to disambiguate dotted identifiers. If multiple
     * known identifiers can parse the same expression, the expression is rejected rather than guessed.
     */
    public Set<String> references(Object value, Set<String> definitionNodeIds) {
        try {
            Object frozen = JsonValues.freeze(value);
            Set<String> knownNodeIds = definitionNodeIds == null ? Set.of() : definitionNodeIds;
            Set<String> references = new LinkedHashSet<>();
            collectReferences(frozen, knownNodeIds, references);
            return Collections.unmodifiableSet(references);
        } catch (MappingException exception) {
            throw exception;
        } catch (IllegalArgumentException exception) {
            throw new MappingException("The mapping value is invalid.");
        }
    }

    private Object resolveValue(
            Object value, MappingContext context, String destinationNodeId, String destinationField) {
        if (value instanceof String text) {
            return resolveString(text, context, destinationNodeId, destinationField);
        }
        if (value instanceof Map<?, ?> object) {
            Map<String, Object> resolved = new LinkedHashMap<>(object.size());
            for (Map.Entry<?, ?> entry : object.entrySet()) {
                String key = (String) entry.getKey();
                resolved.put(key, resolveValue(entry.getValue(), context, destinationNodeId, destinationField));
            }
            return Collections.unmodifiableMap(resolved);
        }
        if (value instanceof List<?> array) {
            List<Object> resolved = new ArrayList<>(array.size());
            for (Object item : array) {
                resolved.add(resolveValue(item, context, destinationNodeId, destinationField));
            }
            return Collections.unmodifiableList(resolved);
        }
        return value;
    }

    private Object resolveString(
            String text, MappingContext context, String destinationNodeId, String destinationField) {
        StringBuilder rendered = new StringBuilder(text.length());
        int cursor = 0;
        while (true) {
            int start = text.indexOf("{{", cursor);
            int strayClose = text.indexOf("}}", cursor);
            if (strayClose >= 0 && (start < 0 || strayClose < start)) {
                throw error(destinationNodeId, destinationField, "The mapping expression is invalid.");
            }
            if (start < 0) {
                rendered.append(text, cursor, text.length());
                return rendered.toString();
            }

            rendered.append(text, cursor, start);
            int end = text.indexOf("}}", start + 2);
            int nestedStart = text.indexOf("{{", start + 2);
            if (end < 0 || nestedStart >= 0 && nestedStart < end) {
                throw error(destinationNodeId, destinationField, "The mapping expression is invalid.");
            }

            String expression = text.substring(start + 2, end).trim();
            ParsedExpression parsed = parseExpression(expression, context.outputs().keySet());
            Object mapped = read(parsed, context, destinationNodeId, destinationField);
            if (start == 0 && end + 2 == text.length()) {
                return mapped;
            }
            appendScalar(rendered, mapped, destinationNodeId, destinationField);
            cursor = end + 2;
        }
    }

    private Object read(
            ParsedExpression expression,
            MappingContext context,
            String destinationNodeId,
            String destinationField) {
        Object current = switch (expression.root()) {
            case TRIGGER_INPUT -> context.triggerInput();
            case VARIABLES -> context.variables();
            case NODE_OUTPUT -> {
                if (!context.outputs().containsKey(expression.nodeId())) {
                    throw error(destinationNodeId, destinationField, "The referenced output is unavailable.");
                }
                yield context.outputs().get(expression.nodeId());
            }
        };

        for (String segment : expression.path()) {
            if (!(current instanceof Map<?, ?> object) || !object.containsKey(segment)) {
                throw error(destinationNodeId, destinationField, "The referenced property is unavailable.");
            }
            current = object.get(segment);
        }
        return current;
    }

    private void appendScalar(
            StringBuilder rendered, Object value, String destinationNodeId, String destinationField) {
        if (value == null) {
            rendered.append("null");
        } else if (value instanceof String || value instanceof Number || value instanceof Boolean) {
            rendered.append(value);
        } else {
            throw error(destinationNodeId, destinationField, "Only scalar values can be interpolated.");
        }
    }

    private void collectReferences(Object value, Set<String> knownNodeIds, Set<String> references) {
        if (value instanceof String text) {
            for (String expression : expressions(text)) {
                ParsedExpression parsed = parseExpression(expression, knownNodeIds);
                if (parsed.root() == Root.NODE_OUTPUT) {
                    references.add(parsed.nodeId());
                }
            }
        } else if (value instanceof Map<?, ?> object) {
            object.values().forEach(item -> collectReferences(item, knownNodeIds, references));
        } else if (value instanceof List<?> array) {
            array.forEach(item -> collectReferences(item, knownNodeIds, references));
        }
    }

    private List<String> expressions(String text) {
        List<String> expressions = new ArrayList<>();
        int cursor = 0;
        while (true) {
            int start = text.indexOf("{{", cursor);
            int strayClose = text.indexOf("}}", cursor);
            if (strayClose >= 0 && (start < 0 || strayClose < start)) {
                throw new MappingException("The mapping expression is invalid.");
            }
            if (start < 0) {
                return expressions;
            }
            int end = text.indexOf("}}", start + 2);
            int nestedStart = text.indexOf("{{", start + 2);
            if (end < 0 || nestedStart >= 0 && nestedStart < end) {
                throw new MappingException("The mapping expression is invalid.");
            }
            expressions.add(text.substring(start + 2, end).trim());
            cursor = end + 2;
        }
    }

    private ParsedExpression parseExpression(String expression, Set<String> knownNodeIds) {
        if (expression.equals("trigger.input")) {
            return new ParsedExpression(Root.TRIGGER_INPUT, null, List.of());
        }
        if (expression.startsWith("trigger.input.")) {
            return new ParsedExpression(Root.TRIGGER_INPUT, null, parsePath(expression.substring(14)));
        }
        if (expression.equals("variables")) {
            return new ParsedExpression(Root.VARIABLES, null, List.of());
        }
        if (expression.startsWith("variables.")) {
            return new ParsedExpression(Root.VARIABLES, null, parsePath(expression.substring(10)));
        }
        if (expression.startsWith(NODE_ROOT)) {
            NodeReference reference = parseNodeReference(expression.substring(NODE_ROOT.length()), knownNodeIds);
            return new ParsedExpression(Root.NODE_OUTPUT, reference.nodeId(), reference.path());
        }
        throw new MappingException("The mapping expression is invalid.");
    }

    private NodeReference parseNodeReference(String nodeAndOutputPath, Set<String> knownNodeIds) {
        List<NodeReference> matchingIds = new ArrayList<>();
        Set<Integer> knownIdLengths = new LinkedHashSet<>();
        knownNodeIds.forEach(nodeId -> knownIdLengths.add(nodeId.length()));
        int marker = nodeAndOutputPath.indexOf(OUTPUT_MARKER);
        while (marker >= 0) {
            if (knownIdLengths.contains(marker)) {
                String possibleNodeId = nodeAndOutputPath.substring(0, marker);
                if (knownNodeIds.contains(possibleNodeId)) {
                    NodeReference candidate = nodeReferenceAt(nodeAndOutputPath, marker);
                    if (candidate != null) {
                        matchingIds.add(candidate);
                    }
                }
            }
            marker = nodeAndOutputPath.indexOf(OUTPUT_MARKER, marker + 1);
        }
        if (matchingIds.size() > 1) {
            throw new MappingException("The node reference is ambiguous.");
        }
        if (matchingIds.size() == 1) {
            return matchingIds.get(0);
        }

        marker = nodeAndOutputPath.indexOf(OUTPUT_MARKER);
        if (marker >= 0) {
            NodeReference fallback = nodeReferenceAt(nodeAndOutputPath, marker);
            if (fallback != null) {
                return fallback;
            }
        }
        throw new MappingException("The mapping expression is invalid.");
    }

    private NodeReference nodeReferenceAt(String value, int marker) {
        String nodeId = value.substring(0, marker);
        int afterMarker = marker + OUTPUT_MARKER.length();
        if (nodeId.isEmpty() || afterMarker < value.length() && value.charAt(afterMarker) != '.') {
            return null;
        }
        if (afterMarker < value.length() && afterMarker + 1 == value.length()) {
            return null;
        }
        String path = afterMarker == value.length() ? "" : value.substring(afterMarker + 1);
        try {
            List<String> segments = path.isEmpty() ? List.of() : parsePath(path);
            return new NodeReference(nodeId, segments);
        } catch (MappingException ignored) {
            return null;
        }
    }

    private List<String> parsePath(String path) {
        if (path.isEmpty()) {
            throw new MappingException("The mapping expression is invalid.");
        }
        String[] segments = path.split("\\.", -1);
        List<String> result = new ArrayList<>(segments.length);
        for (String segment : segments) {
            if (!isPropertySegment(segment)) {
                throw new MappingException("The mapping expression is invalid.");
            }
            result.add(segment);
        }
        return List.copyOf(result);
    }

    private boolean isPropertySegment(String value) {
        if (value.isEmpty()) {
            return false;
        }
        for (int offset = 0; offset < value.length();) {
            int codePoint = value.codePointAt(offset);
            if (!(Character.isLetterOrDigit(codePoint) || codePoint == '_' || codePoint == '$')) {
                return false;
            }
            offset += Character.charCount(codePoint);
        }
        return true;
    }

    private MappingException error(String nodeId, String field, String message) {
        return new MappingException(nodeId, field, message);
    }

    private enum Root {
        TRIGGER_INPUT,
        NODE_OUTPUT,
        VARIABLES
    }

    private record ParsedExpression(Root root, String nodeId, List<String> path) {
    }

    private record NodeReference(String nodeId, List<String> path) {
    }
}
