package com.weav.workflow.domain.definition;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Utilities for copying JSON-compatible values into immutable snapshots. */
public final class JsonValues {
    private JsonValues() {
    }

    /**
     * Copies a JSON value recursively. JSON null is returned as {@code null}.
     * Objects and arrays must be represented by string-keyed maps and lists.
     *
     * @param value a JSON-compatible value
     * @return an immutable copy of the value
     * @throws IllegalArgumentException when the value is not a JSON value
     */
    public static Object freeze(Object value) {
        return freeze(value, new IdentityHashMap<>());
    }

    /**
     * Copies a JSON object recursively. A missing optional object is represented as an empty map.
     *
     * @param value a JSON object or {@code null}
     * @return an immutable JSON object copy
     * @throws IllegalArgumentException when any key or value is not JSON-compatible
     */
    public static Map<String, Object> freezeMap(Map<String, Object> value) {
        if (value == null) {
            return Map.of();
        }
        return freezeObject(value, new IdentityHashMap<>());
    }

    private static Object freeze(Object value, IdentityHashMap<Object, Boolean> activeContainers) {
        if (value == null || value instanceof String || value instanceof Boolean || isImmutableNumber(value)) {
            return value;
        }
        if (value instanceof Map<?, ?> object) {
            return freezeObject(object, activeContainers);
        }
        if (value instanceof List<?> array) {
            return freezeArray(array, activeContainers);
        }
        throw new IllegalArgumentException("Unsupported JSON value type: " + value.getClass().getName());
    }

    private static Map<String, Object> freezeObject(
            Map<?, ?> source, IdentityHashMap<Object, Boolean> activeContainers) {
        enterContainer(source, activeContainers);
        try {
            Map<String, Object> copy = new LinkedHashMap<>(source.size());
            for (Map.Entry<?, ?> entry : source.entrySet()) {
                if (!(entry.getKey() instanceof String key)) {
                    throw new IllegalArgumentException("JSON object keys must be strings");
                }
                copy.put(key, freeze(entry.getValue(), activeContainers));
            }
            return Collections.unmodifiableMap(copy);
        } finally {
            activeContainers.remove(source);
        }
    }

    private static List<Object> freezeArray(List<?> source, IdentityHashMap<Object, Boolean> activeContainers) {
        enterContainer(source, activeContainers);
        try {
            List<Object> copy = new ArrayList<>(source.size());
            for (Object value : source) {
                copy.add(freeze(value, activeContainers));
            }
            return Collections.unmodifiableList(copy);
        } finally {
            activeContainers.remove(source);
        }
    }

    private static void enterContainer(Object container, IdentityHashMap<Object, Boolean> activeContainers) {
        if (activeContainers.containsKey(container)) {
            throw new IllegalArgumentException("Cyclic containers are not valid JSON");
        }
        activeContainers.put(container, Boolean.TRUE);
    }

    private static boolean isImmutableNumber(Object value) {
        Class<?> type = value.getClass();
        if (type == Byte.class || type == Short.class || type == Integer.class || type == Long.class
                || type == BigInteger.class || type == BigDecimal.class) {
            return true;
        }
        if (value instanceof Float number) {
            return Float.isFinite(number);
        }
        if (value instanceof Double number) {
            return Double.isFinite(number);
        }
        return false;
    }
}
