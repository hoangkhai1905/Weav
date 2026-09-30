package com.weav.workflow.domain.definition;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Java twin of ai-service checkOutputSchema (spec §3). Both run the shared fixture. */
public final class OutputSchemaPolicy {
    private static final Set<String> ALLOWED = Set.of(
            "type", "properties", "required", "items", "enum", "description", "additionalProperties");
    private static final Set<String> TYPES = Set.of("object", "array", "string", "number", "integer", "boolean", "null");
    private static final Set<String> FORBIDDEN_NAMES = Set.of("__proto__", "prototype", "constructor");
    private static final int MAX_BYTES = 32 * 1024;
    private static final int MAX_NODES = 256;
    private static final int MAX_DEPTH = 8;

    private OutputSchemaPolicy() {
    }

    public static boolean isValid(Object schema) {
        if (!(schema instanceof Map<?, ?> root) || !"object".equals(root.get("type"))
                || DefinitionValidator.jsonSize(root) > MAX_BYTES) {
            return false;
        }
        int nodes = 0;
        Deque<Object[]> stack = new ArrayDeque<>();
        stack.push(new Object[] {root, 1});
        while (!stack.isEmpty()) {
            Object[] frame = stack.pop();
            if (!(frame[0] instanceof Map<?, ?> node) || !node.containsKey("type")) {
                return false;
            }
            int depth = (int) frame[1];
            if (++nodes > MAX_NODES || depth > MAX_DEPTH) {
                return false;
            }
            Object typeValue = node.get("type");
            Set<String> types = typeValue instanceof List<?> list
                    ? list.stream().filter(String.class::isInstance).map(String.class::cast).collect(java.util.stream.Collectors.toSet())
                    : typeValue instanceof String text ? Set.of(text) : Set.of();
            for (Map.Entry<?, ?> entry : node.entrySet()) {
                if (!(entry.getKey() instanceof String keyword) || !ALLOWED.contains(keyword)
                        || !validKeyword(keyword, entry.getValue(), node, types, depth, stack)) {
                    return false;
                }
            }
        }
        return true;
    }

    private static boolean validKeyword(String keyword, Object value, Map<?, ?> node, Set<String> types,
                                        int depth, Deque<Object[]> stack) {
        if (Set.of("properties", "required", "additionalProperties").contains(keyword) && !types.contains("object")) {
            return false;
        }
        if ("items".equals(keyword) && !types.contains("array")) {
            return false;
        }
        return switch (keyword) {
            case "type" -> isType(value) || value instanceof List<?> list && !list.isEmpty()
                    && list.stream().allMatch(OutputSchemaPolicy::isType);
            case "description" -> value instanceof String text && text.length() <= 1000;
            case "additionalProperties" -> value instanceof Boolean;
            case "required" -> value instanceof List<?> list && list.stream().allMatch(String.class::isInstance)
                    && new HashSet<>(list).size() == list.size()
                    && list.stream().allMatch(name -> node.get("properties") instanceof Map<?, ?> properties
                    && properties.containsKey(name));
            case "enum" -> value instanceof List<?> list && !list.isEmpty() && list.size() <= 100
                    && list.stream().allMatch(item -> item == null || item instanceof String
                            || item instanceof Number || item instanceof Boolean);
            case "items" -> {
                stack.push(new Object[] {value, depth + 1});
                yield true;
            }
            case "properties" -> {
                if (!(value instanceof Map<?, ?> properties)) {
                    yield false;
                }
                for (Map.Entry<?, ?> property : properties.entrySet()) {
                    if (!(property.getKey() instanceof String name) || name.isEmpty() || name.length() > 64
                            || FORBIDDEN_NAMES.contains(name)) {
                        yield false;
                    }
                    stack.push(new Object[] {property.getValue(), depth + 1});
                }
                yield true;
            }
            default -> false;
        };
    }

    private static boolean isType(Object value) {
        return value instanceof String text && TYPES.contains(text);
    }
}
