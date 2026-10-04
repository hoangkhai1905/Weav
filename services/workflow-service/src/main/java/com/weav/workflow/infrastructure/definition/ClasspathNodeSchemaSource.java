package com.weav.workflow.infrastructure.definition;

import com.weav.workflow.domain.definition.NodeConfigSchema;
import com.weav.workflow.domain.definition.NodeConfigSchema.Field;
import com.weav.workflow.domain.definition.NodeSchemaSource;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Loads {@code workflow-schema/nodes/*.json} from the classpath and parses the supported JSON Schema subset.
 * Any file that is invalid, misnamed or uses another keyword aborts loading.
 */
public final class ClasspathNodeSchemaSource implements NodeSchemaSource {
    private static final String PATTERN = "classpath*:workflow-schema/nodes/*.json";
    private static final Set<String> TYPES = Set.of("string", "object", "array", "boolean", "integer");
    private static final Set<String> ROOT_KEYWORDS = Set.of("$schema", "$id", "title", "description", "type",
            "properties", "required", "additionalProperties", "x-weav-node", "x-weav-mutually-exclusive");
    private static final Set<String> FIELD_KEYWORDS = Set.of("type", "enum", "items", "oneOf",
            "additionalProperties", "minLength", "minItems", "minimum", "title", "description",
            "x-weav-template", "x-weav-connection", "x-weav-static");
    private static final Set<String> CATEGORIES = Set.of("trigger", "action", "logic", "ai");

    private final JsonMapper mapper = JsonMapper.builder().build();

    @Override
    public Map<String, NodeConfigSchema> load() {
        Map<String, NodeConfigSchema> schemas = new LinkedHashMap<>();
        try {
            for (Resource resource : new PathMatchingResourcePatternResolver().getResources(PATTERN)) {
                try (InputStream in = resource.getInputStream()) {
                    NodeConfigSchema schema = parse(resource.getFilename(), mapper.readTree(in));
                    if (schemas.put(schema.type(), schema) != null) {
                        throw new IllegalStateException("Duplicate node schema " + schema.type());
                    }
                }
            }
        } catch (IOException | RuntimeException e) {
            throw new IllegalStateException("Cannot load node config schemas: " + e.getMessage(), e);
        }
        return schemas;
    }

    static NodeConfigSchema parse(String fileName, JsonNode root) {
        if (fileName == null || !fileName.endsWith(".json")) {
            throw new IllegalArgumentException("Schema file must be named <node type>.json");
        }
        String type = fileName.substring(0, fileName.length() - ".json".length());
        requireObject(root, type);
        rejectUnsupported(root, ROOT_KEYWORDS, type);
        require("object".equals(text(root, "type")), type, "type must be object");
        require(root.has("additionalProperties") && root.get("additionalProperties").isBoolean()
                && !root.get("additionalProperties").booleanValue(), type, "additionalProperties must be false");
        require(("weav:node/" + type).equals(text(root, "$id")), type, "$id must be weav:node/" + type);
        JsonNode meta = root.get("x-weav-node");
        requireObject(meta, type);
        require(type.equals(text(meta, "type")), type, "x-weav-node.type must equal the file name");
        require(CATEGORIES.contains(text(meta, "category")), type, "x-weav-node.category is invalid");
        String label = text(meta, "label");
        require(label != null && !label.isBlank(), type, "x-weav-node.label is required");
        require(meta.has("sideEffect") && meta.get("sideEffect").isBoolean(), type,
                "x-weav-node.sideEffect must be boolean");

        JsonNode props = root.get("properties");
        requireObject(props, type);
        Map<String, Field> fields = new LinkedHashMap<>();
        for (Map.Entry<String, JsonNode> property : props.properties()) {
            fields.put(property.getKey(), field(property.getValue(), type + "." + property.getKey()));
        }
        List<String> required = new ArrayList<>();
        JsonNode requiredNode = root.get("required");
        require(requiredNode != null && requiredNode.isArray(), type, "required must be an array");
        for (JsonNode name : requiredNode) {
            require(name.isString() && fields.containsKey(name.stringValue()), type,
                    "required entries must name declared properties");
            required.add(name.stringValue());
        }
        return new NodeConfigSchema(type, text(meta, "category"), label,
                meta.get("sideEffect").booleanValue(), fields, required);
    }

    private static Field field(JsonNode node, String where) {
        requireObject(node, where);
        rejectUnsupported(node, FIELD_KEYWORDS, where);
        String type = text(node, "type");
        require(!node.has("type") || type != null && TYPES.contains(type), where, "unsupported type");
        Set<String> enumValues = new LinkedHashSet<>();
        if (node.has("enum")) {
            require(node.get("enum").isArray(), where, "enum must be an array");
            for (JsonNode value : node.get("enum")) {
                require(value.isString(), where, "enum values must be strings");
                enumValues.add(value.stringValue());
            }
        }
        List<Field> oneOf = new ArrayList<>();
        if (node.has("oneOf")) {
            require(node.get("oneOf").isArray(), where, "oneOf must be an array");
            for (JsonNode branch : node.get("oneOf")) {
                oneOf.add(field(branch, where + ".oneOf"));
            }
        }
        JsonNode additional = node.get("additionalProperties");
        require(additional == null || additional.isObject(), where, "additionalProperties must be a schema");
        JsonNode items = node.get("items");
        String provider = null;
        if (node.has("x-weav-connection")) {
            provider = text(node.get("x-weav-connection"), "provider");
            require(provider != null && !provider.isBlank(), where, "x-weav-connection.provider is required");
        }
        require(!node.has("minimum") || node.get("minimum").isNumber(), where, "minimum must be a number");
        return new Field(type, Set.copyOf(enumValues),
                items == null ? null : field(items, where + ".items"), List.copyOf(oneOf),
                additional == null ? null : field(additional, where + ".additionalProperties"),
                intValue(node, "minLength", where), intValue(node, "minItems", where),
                node.has("minimum") ? node.get("minimum").decimalValue() : null,
                flag(node, "x-weav-template", where), provider, flag(node, "x-weav-static", where));
    }

    private static Integer intValue(JsonNode node, String name, String where) {
        if (!node.has(name)) {
            return null;
        }
        require(node.get(name).isInt() && node.get(name).intValue() >= 0, where,
                name + " must be a non-negative integer");
        return node.get(name).intValue();
    }

    private static boolean flag(JsonNode node, String name, String where) {
        if (!node.has(name)) {
            return false;
        }
        require(node.get(name).isBoolean(), where, name + " must be boolean");
        return node.get(name).booleanValue();
    }

    private static String text(JsonNode node, String name) {
        JsonNode value = node == null ? null : node.get(name);
        return value != null && value.isString() ? value.stringValue() : null;
    }

    private static void rejectUnsupported(JsonNode node, Set<String> allowed, String where) {
        for (Map.Entry<String, JsonNode> property : node.properties()) {
            require(allowed.contains(property.getKey()), where, "unsupported keyword " + property.getKey());
        }
    }

    private static void requireObject(JsonNode node, String where) {
        require(node != null && node.isObject(), where, "expected a JSON object");
    }

    private static void require(boolean condition, String where, String message) {
        if (!condition) {
            throw new IllegalArgumentException(where + ": " + message);
        }
    }
}
