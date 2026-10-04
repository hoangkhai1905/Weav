package com.weav.workflow.domain.definition;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.ServiceLoader;

/**
 * Registry of node config schemas, loaded once through the single {@link NodeSchemaSource} on the classpath.
 * A broken schema set fails class initialization, so the service cannot start with a partial catalog.
 */
public final class NodeConfigSchemas {
    private static final Map<String, NodeConfigSchema> SCHEMAS = load();

    private NodeConfigSchemas() {
    }

    public static Map<String, NodeConfigSchema> all() {
        return SCHEMAS;
    }

    private static Map<String, NodeConfigSchema> load() {
        List<NodeSchemaSource> sources = new ArrayList<>();
        ServiceLoader.load(NodeSchemaSource.class, NodeConfigSchemas.class.getClassLoader()).forEach(sources::add);
        if (sources.size() != 1) {
            throw new IllegalStateException(
                    "Exactly one NodeSchemaSource is required but found " + sources.size());
        }
        Map<String, NodeConfigSchema> schemas = Map.copyOf(sources.get(0).load());
        if (schemas.isEmpty()) {
            throw new IllegalStateException("No node config schemas were loaded");
        }
        return schemas;
    }
}
