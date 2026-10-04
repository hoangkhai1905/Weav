package com.weav.workflow.domain.definition;

import java.util.Map;

/** Supplies the node config schemas, keyed by node type. Discovered through {@link java.util.ServiceLoader}. */
public interface NodeSchemaSource {
    /** @throws IllegalStateException when a schema is missing, invalid or uses an unsupported keyword */
    Map<String, NodeConfigSchema> load();
}
