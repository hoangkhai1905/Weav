package com.weav.workspace;

import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class WorkflowContractValidationTest {

    @Test
    void connectionUsageContractFreezesInternalRouteAndStrictBooleanResponse() throws IOException {
        Map<String, Object> document = loadContract();
        assertThat(document.get("openapi")).isEqualTo("3.1.0");

        Map<String, Object> paths = map(document, "paths");
        Map<String, Object> operation = map(
                map(paths, "/internal/workspaces/{workspaceId}/connections/{connectionId}/usage"),
                "get");
        assertThat(operation.get("operationId")).isEqualTo("getConnectionUsage");
        assertThat(operation.get("security")).asInstanceOf(
                org.assertj.core.api.InstanceOfAssertFactories.LIST)
                .anySatisfy(security -> assertThat(mapValue(security, "internalServiceKey")).isNotNull());

        Map<String, Object> responses = map(operation, "responses");
        assertThat(responses).containsKeys("200", "401", "404", "429", "500");
        Map<String, Object> successSchema = map(
                map(map(responses, "200"), "content"), "application/json");
        assertThat(map(successSchema, "schema").get("$ref"))
                .isEqualTo("#/components/schemas/ConnectionUsageResponse");

        Map<String, Object> schemas = map(map(document, "components"), "schemas");
        Map<String, Object> usage = map(schemas, "ConnectionUsageResponse");
        assertThat(usage.get("required")).isEqualTo(List.of("inUse"));
        assertThat(map(map(usage, "properties"), "inUse").get("type"))
                .isEqualTo("boolean");
    }

    private Map<String, Object> loadContract() throws IOException {
        Path path = Path.of("..", "..", "packages", "contracts", "http", "workflow", "openapi.yaml");
        assertThat(Files.exists(path)).as(path.toString()).isTrue();
        return mapValue(new Yaml().load(Files.readString(path)), "document");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> map(Map<String, Object> source, String key) {
        return mapValue(source.get(key), key);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> mapValue(Object value, String name) {
        assertThat(value).as(name).isInstanceOf(Map.class);
        return (Map<String, Object>) value;
    }
}
