package com.weav.workspace;

import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class WorkspaceContractValidationTest {

    private static final List<String> WORKSPACE_OPERATION_IDS = List.of(
            "createWorkspace",
            "listMyWorkspaces",
            "getWorkspace",
            "renameWorkspace",
            "listWorkspaceMembers",
            "addWorkspaceMember",
            "updateWorkspaceMemberPermissions",
            "removeWorkspaceMember",
            "leaveWorkspace",
            "getInternalWorkspaceAccess");

    private static final Set<String> HTTP_METHODS = Set.of(
            "get", "post", "put", "patch", "delete", "head", "options", "trace");

    @Test
    void workspaceContractHasStructuredOperationsSecurityReferencesAndShapes() throws Exception {
        Map<String, Object> contract = loadContract(workspaceContractPath());
        Map<String, Object> components = map(contract, "components");
        Map<String, Object> schemas = map(components, "schemas");
        Map<String, Object> responses = map(components, "responses");

        assertThat(contract.get("openapi")).isEqualTo("3.1.0");
        assertThat(list(contract, "security")).anySatisfy(security ->
                assertThat(mapValue(security, "bearerAuth")).isNotNull());
        assertThat(map(components, "securitySchemes")).containsKeys("bearerAuth", "internalServiceKey");
        assertThat(responses).containsKey("InternalError");
        assertThat(map(responses, "InternalError").get("content")).isInstanceOf(Map.class);
        assertThat(map(map(map(responses, "InternalError"), "content"), "application/json")
                .get("schema")).isEqualTo(Map.of("$ref", "#/components/schemas/ErrorResponse"));

        Map<String, Map<String, Object>> operations = operations(map(contract, "paths"));
        assertThat(operations.keySet()).containsExactlyInAnyOrderElementsOf(WORKSPACE_OPERATION_IDS);
        for (Map.Entry<String, Map<String, Object>> operation : operations.entrySet()) {
            Map<String, Object> operationResponses = map(operation.getValue(), "responses");
            assertThat(operationResponses).as(operation.getKey()).containsKey("500");
            assertThat(map(operationResponses, "500").get("$ref"))
                    .as(operation.getKey())
                    .isEqualTo("#/components/responses/InternalError");
        }

        Map<String, Object> errorResponse = map(schemas, "ErrorResponse");
        assertThat(stringList(errorResponse, "required"))
                .containsExactlyInAnyOrderElementsOf(List.of("code", "message", "requestId"));
        assertThat(schemas).containsKeys(
                "WorkspaceResponse", "WorkspacePageResponse", "MemberView", "MemberPageResponse",
                "WorkspaceAccessResponse", "WorkspaceCapability", "MembershipRole");
        assertThat(stringList(map(schemas, "WorkspaceAccessResponse"), "required"))
                .containsExactlyInAnyOrderElementsOf(
                        List.of("workspaceId", "userId", "role", "capabilities"));
        assertThat(map(map(schemas, "WorkspacePageResponse"), "properties")).containsKeys(
                "items", "page", "size", "totalElements", "totalPages");
        assertThat(stringList(map(map(map(schemas, "MemberView"), "properties"), "displayName"), "type"))
                .containsExactlyElementsOf(List.of("string", "null"));
        assertThat(map(map(components, "parameters"), "Size").get("name")).isEqualTo("size");
        assertThat(map(map(map(components, "parameters"), "Size"), "schema").get("maximum"))
                .isEqualTo(100);

        Map<String, Object> internalOperation = operations.get("getInternalWorkspaceAccess");
        assertThat(list(internalOperation, "security")).anySatisfy(security ->
                assertThat(mapValue(security, "internalServiceKey")).isNotNull());
        assertLocalReferencesResolve(contract);
    }

    @Test
    void identityDirectoryContractUsesBoundedChunksAndDocumentsExactGlobalOrdering() throws Exception {
        Map<String, Object> contract = loadContract(identityContractPath());
        Map<String, Map<String, Object>> operations = operations(map(contract, "paths"));
        assertThat(operations).containsKeys(
                "lookupDirectoryUserByEmail", "matchDirectoryUserIds",
                "searchDirectoryUsers", "getDirectoryUsersByIds");

        Map<String, Object> schemas = map(map(contract, "components"), "schemas");
        Map<String, Object> candidateIds = map(map(schemas, "DirectoryMatchRequest"), "properties");
        assertThat(map(candidateIds, "candidateUserIds").get("maxItems")).isEqualTo(500);
        assertThat(map(candidateIds, "candidateUserIds").get("description").toString())
                .containsIgnoringCase("bounded transport")
                .containsIgnoringCase("product membership cap");
        assertThat(map(map(schemas, "IdentityUserIdSet"), "properties")
                .get("matchingUserIds")).isInstanceOf(Map.class);
        assertThat(stringList(map(schemas, "IdentityUserIdSet"), "required"))
                .containsExactly("matchingUserIds");
        assertThat(map(map(map(schemas, "IdentityUserIdSet"), "properties"), "matchingUserIds")
                .get("maxItems")).isEqualTo(500);
        assertThat(map(map(schemas, "DirectorySearchRequest"), "properties")
                .get("candidateUserIds")).isInstanceOf(Map.class);
        assertThat(map(map(map(schemas, "DirectorySearchRequest"), "properties"), "candidateUserIds")
                .get("maxItems")).isEqualTo(500);
        assertThat(map(map(schemas, "DirectoryBatchRequest"), "properties")
                .get("userIds")).isInstanceOf(Map.class);
        assertThat(map(map(map(schemas, "DirectoryBatchRequest"), "properties"), "userIds")
                .get("maxItems")).isEqualTo(500);
        assertThat(stringList(map(schemas, "IdentityUserPage"), "required"))
                .containsExactlyInAnyOrderElementsOf(
                        List.of("items", "page", "size", "totalElements", "totalPages"));

        for (String operationId : List.of(
                "lookupDirectoryUserByEmail", "matchDirectoryUserIds",
                "searchDirectoryUsers", "getDirectoryUsersByIds")) {
            Map<String, Object> operation = operations.get(operationId);
            assertThat(list(operation, "security")).anySatisfy(security ->
                    assertThat(mapValue(security, "internalServiceKey")).isNotNull());
            assertThat(map(map(operation, "responses"), "500").get("$ref"))
                    .isEqualTo("#/components/responses/InternalError");
        }

        assertThat(map(schemas, "DirectorySearchRequest").get("description").toString())
                .containsIgnoringCase("merge")
                .containsIgnoringCase("null")
                .containsIgnoringCase("userId")
                .containsIgnoringCase("exact");
        assertLocalReferencesResolve(contract);
    }

    private Path workspaceContractPath() {
        return Path.of("..", "..", "packages", "contracts", "http", "workspace", "openapi.yaml");
    }

    private Path identityContractPath() {
        return Path.of("..", "..", "packages", "contracts", "http", "auth", "openapi.yaml");
    }

    private Map<String, Object> loadContract(Path path) throws IOException {
        assertThat(Files.exists(path)).as(path.toString()).isTrue();
        Object parsed = new Yaml().load(Files.readString(path));
        return mapValue(parsed, "document");
    }

    private Map<String, Map<String, Object>> operations(Map<String, Object> paths) {
        Map<String, Map<String, Object>> result = new LinkedHashMap<>();
        for (Object pathValue : paths.values()) {
            Map<String, Object> path = mapValue(pathValue, "path");
            for (Map.Entry<String, Object> entry : path.entrySet()) {
                if (!HTTP_METHODS.contains(entry.getKey())) {
                    continue;
                }
                Map<String, Object> operation = mapValue(entry.getValue(), entry.getKey());
                Object operationId = operation.get("operationId");
                if (operationId != null) {
                    result.put(operationId.toString(), operation);
                }
            }
        }
        return result;
    }

    private void assertLocalReferencesResolve(Map<String, Object> document) {
        List<String> references = new ArrayList<>();
        collectReferences(document, references);
        for (String reference : references) {
            if (!reference.startsWith("#/")) {
                continue;
            }
            Object resolved = document;
            for (String segment : reference.substring(2).split("/")) {
                String key = segment.replace("~1", "/").replace("~0", "~");
                if (!(resolved instanceof Map<?, ?> map)) {
                    resolved = null;
                    break;
                }
                resolved = map.get(key);
            }
            assertThat(resolved).as("OpenAPI reference %s", reference).isNotNull();
        }
    }

    private void collectReferences(Object value, List<String> references) {
        if (value instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if ("$ref".equals(entry.getKey()) && entry.getValue() instanceof String reference) {
                    references.add(reference);
                }
                collectReferences(entry.getValue(), references);
            }
        } else if (value instanceof List<?> list) {
            list.forEach(item -> collectReferences(item, references));
        }
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

    private List<?> list(Map<String, Object> source, String key) {
        Object value = source.get(key);
        assertThat(value).as(key).isInstanceOf(List.class);
        return (List<?>) value;
    }

    @SuppressWarnings("unchecked")
    private List<String> stringList(Map<String, Object> source, String key) {
        Object value = source.get(key);
        assertThat(value).as(key).isInstanceOf(List.class);
        return (List<String>) value;
    }
}
