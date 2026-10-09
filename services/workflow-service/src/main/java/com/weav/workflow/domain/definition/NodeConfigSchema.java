package com.weav.workflow.domain.definition;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Pure model of one node's config schema (the supported subset of JSON Schema, loaded from
 * {@code packages/workflow-schema/nodes}). Checks here only cover shape and emptiness; mapping
 * grammar, enum codes and cross-field rules stay in {@link DefinitionValidator}.
 */
public record NodeConfigSchema(
        String type,
        String category,
        String label,
        boolean sideEffect,
        Map<String, Field> properties,
        List<String> required) {

    public NodeConfigSchema {
        properties = Map.copyOf(properties);
        required = List.copyOf(required);
    }

    public Set<String> fieldNames() {
        return properties.keySet();
    }

    public Set<String> staticFields() {
        return properties.entrySet().stream()
                .filter(entry -> entry.getValue().isStatic())
                .map(Map.Entry::getKey)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
    }

    /** Fields holding a credential reference ({@code x-weav-connection}). */
    public Set<String> connectionFields() {
        return properties.entrySet().stream()
                .filter(entry -> entry.getValue().connectionProvider() != null)
                .map(Map.Entry::getKey)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
    }

    /** Fields that identify a person or their resources ({@code x-weav-personal}): stripped from shared templates. */
    public Set<String> personalFields() {
        return properties.entrySet().stream()
                .filter(entry -> entry.getValue().personal())
                .map(Map.Entry::getKey)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
    }

    /** Template fields declared as plain {@code type: string} (no oneOf, no untyped "any value"). */
    public Set<String> stringOnlyFields() {
        return properties.entrySet().stream()
                .filter(entry -> entry.getValue().template() && "string".equals(entry.getValue().type())
                        && entry.getValue().oneOf().isEmpty())
                .map(Map.Entry::getKey)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
    }

    /**
     * One property schema. {@code type} is null for "any value"; {@code minLength} 1 means non-blank.
     *
     * @param template accepts {{ }} mappings in place of a literal of the declared type
     * @param isStatic literal metadata: never mapping-resolved and never credential-key scanned
     * @param personal identifies a person or their resources: a shared template keeps it only as a pure mapping
     */
    public record Field(
            String type,
            Set<String> enumValues,
            Field items,
            List<Field> oneOf,
            Field additionalProperties,
            Integer minLength,
            Integer minItems,
            BigDecimal minimum,
            boolean template,
            String connectionProvider,
            boolean isStatic,
            Integer maxLength,
            BigDecimal maximum,
            boolean personal) {

        /** Pre-W6-C signature: a field that is not personal. */
        public Field(String type, Set<String> enumValues, Field items, List<Field> oneOf,
                     Field additionalProperties, Integer minLength, Integer minItems, BigDecimal minimum,
                     boolean template, String connectionProvider, boolean isStatic, Integer maxLength,
                     BigDecimal maximum) {
            this(type, enumValues, items, oneOf, additionalProperties, minLength, minItems, minimum, template,
                    connectionProvider, isStatic, maxLength, maximum, false);
        }

        /** Type, items, oneOf, additionalProperties and minimum. Enums are checked by the catalog rules. */
        public boolean matchesShape(Object value) {
            if (!oneOf.isEmpty()) {
                return oneOf.stream().filter(branch -> branch.matchesShape(value)).count() == 1;
            }
            if (type == null) {
                return true;
            }
            return switch (type) {
                case "string" -> value instanceof String text && (maxLength == null || text.codePointCount(0, text.length()) <= maxLength);
                case "boolean" -> value instanceof Boolean;
                case "integer" -> isInteger(value) && (minimum == null || toDecimal(value).compareTo(minimum) >= 0)
                        && (maximum == null || toDecimal(value).compareTo(maximum) <= 0);
                case "array" -> value instanceof List<?> list
                        && (items == null || list.stream().allMatch(items::matchesShape));
                case "object" -> value instanceof Map<?, ?> map && map.entrySet().stream().allMatch(entry ->
                        entry.getKey() instanceof String
                                && (additionalProperties == null || additionalProperties.matchesShape(entry.getValue())));
                default -> false;
            };
        }

        /** True when a value of valid shape is blank, too short or has a blank item (publish only). */
        public boolean violatesMinimumContent(Object value) {
            if (!oneOf.isEmpty()) {
                return oneOf.stream().filter(branch -> branch.matchesShape(value)).findFirst()
                        .map(branch -> branch.violatesMinimumContent(value)).orElse(false);
            }
            if (value instanceof String text) {
                return minLength != null && minLength > 0 && text.isBlank();
            }
            if (value instanceof List<?> list) {
                return minItems != null && list.size() < minItems
                        || items != null && list.stream().anyMatch(items::violatesMinimumContent);
            }
            return false;
        }

        private static boolean isInteger(Object value) {
            if (value instanceof BigDecimal decimal) {
                return decimal.stripTrailingZeros().scale() <= 0;
            }
            return value instanceof BigInteger || value instanceof Byte || value instanceof Short
                    || value instanceof Integer || value instanceof Long;
        }

        private static BigDecimal toDecimal(Object value) {
            return value instanceof BigDecimal decimal ? decimal
                    : value instanceof BigInteger integer ? new BigDecimal(integer)
                    : BigDecimal.valueOf(((Number) value).longValue());
        }
    }
}
