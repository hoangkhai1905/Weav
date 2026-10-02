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
        assertThat(responses).containsKeys("200", "401", "429", "500")
                .doesNotContainKey("404");
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

    @Test
    void workflowDetailContractAddsOnlyTheSafeTriggerProjection() throws IOException {
        Map<String, Object> document = loadContract();
        Map<String, Object> paths = map(document, "paths");
        Map<String, Object> detail = map(map(paths, "/workspaces/{workspaceId}/workflows/{workflowId}"), "get");
        Map<String, Object> responses = map(detail, "responses");
        Map<String, Object> successSchema = map(
                map(map(responses, "200"), "content"), "application/json");
        assertThat(map(successSchema, "schema").get("$ref"))
                .isEqualTo("#/components/schemas/Workflow");

        Map<String, Object> schemas = map(map(document, "components"), "schemas");
        Map<String, Object> workflow = map(schemas, "Workflow");
        assertThat(workflow.get("additionalProperties")).isEqualTo(true);
        assertThat(workflow.get("required")).isEqualTo(List.of("workflowId", "status"));

        Map<String, Object> triggerList = map(map(workflow, "properties"), "triggers");
        assertThat(triggerList.get("type")).isEqualTo("array");
        Map<String, Object> registration = mapValue(triggerList.get("items"), "triggers.items");
        assertThat(registration.get("additionalProperties")).isEqualTo(false);
        assertThat(registration.get("required")).isEqualTo(List.of(
                "triggerId", "type", "status", "reasonCode", "nextRunAt", "lastTriggeredAt"));

        Map<String, Object> properties = map(registration, "properties");
        assertThat(properties).containsOnlyKeys(
                "triggerId", "type", "status", "reasonCode", "nextRunAt", "lastTriggeredAt");
        assertThat(map(properties, "triggerId").get("format")).isEqualTo("uuid");
        assertThat(map(properties, "type").get("enum")).isEqualTo(List.of("SCHEDULE", "WEBHOOK", "TELEGRAM"));
        assertThat(map(properties, "status").get("enum")).isEqualTo(List.of("ACTIVE", "DISABLED"));
        assertThat(map(properties, "reasonCode").get("enum"))
                .isEqualTo(List.of("DEPENDENCY_NOT_CONFIGURED", "SCHEDULE_ADMISSION_FAILED"));
        assertThat(map(properties, "reasonCode").get("nullable")).isEqualTo(true);
        assertThat(map(properties, "nextRunAt").get("format")).isEqualTo("date-time");
        assertThat(map(properties, "nextRunAt").get("nullable")).isEqualTo(true);
        assertThat(map(properties, "lastTriggeredAt").get("format")).isEqualTo("date-time");
        assertThat(map(properties, "lastTriggeredAt").get("nullable")).isEqualTo(true);
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
