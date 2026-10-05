package com.weav.workflow.domain.definition;

import java.util.Map;
import java.util.Set;

/** The supported node catalog, derived from the node config schemas in {@code packages/workflow-schema}. */
public final class NodeCatalog {
    private static final Map<String, NodeConfigSchema> SCHEMAS = NodeConfigSchemas.all();

    private NodeCatalog() {
    }

    public static Set<String> supportedTypes() {
        return SCHEMAS.keySet();
    }

    public static boolean supports(String type) {
        return type != null && SCHEMAS.containsKey(type);
    }

    public static Set<String> configFields(String type) {
        NodeConfigSchema schema = schema(type);
        return schema == null ? Set.of() : schema.fieldNames();
    }

    /** Config fields that are literal metadata: never mapping-resolved and never credential-key scanned. */
    public static Set<String> staticFields(String type) {
        NodeConfigSchema schema = schema(type);
        return schema == null ? Set.of() : schema.staticFields();
    }

    /** The config schema for a node type, or null when the type is unsupported. */
    public static NodeConfigSchema schema(String type) {
        return type == null ? null : SCHEMAS.get(type);
    }
}
