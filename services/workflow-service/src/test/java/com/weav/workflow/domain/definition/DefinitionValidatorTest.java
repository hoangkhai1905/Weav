package com.weav.workflow.domain.definition;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DefinitionValidatorTest {
    private final DefinitionValidator validator = new DefinitionValidator();

    @Test
    void draftAllowsIncompleteConfigurationAndDefersPublishGraphSemantics() {
        WorkflowDefinition draft = definition(
                List.of(manual("manual"), node("request", "http.request", Map.of())),
                List.of(edge("e1", "manual", "request")));

        assertTrue(validator.validateDraft(draft).isEmpty());
        assertTrue(validator.validatePublish(draft).stream()
                .anyMatch(issue -> issue.nodeId().equals("request")
                        && issue.code().equals("REQUIRED_FIELD_MISSING")));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidGraphs")
    void rejectsInvalidPublishedGraphs(String name, WorkflowDefinition graph, String expectedCode) {
        assertTrue(validator.validatePublish(graph).stream().anyMatch(issue -> issue.code().equals(expectedCode)),
                () -> "Expected " + expectedCode + " for " + name + " but got " + validator.validatePublish(graph));
    }

    static Stream<Arguments> invalidGraphs() {
        return Stream.of(
                Arguments.of("duplicate node IDs", definition(
                        List.of(manual("same"), node("same", "http.request", httpConfig())), List.of()),
                        "DUPLICATE_NODE_ID"),
                Arguments.of("duplicate edge IDs", definition(
                        List.of(manual("manual"), node("request", "http.request", httpConfig())),
                        List.of(edge("same", "manual", "request"), edge("same", "manual", "request"))),
                        "DUPLICATE_EDGE_ID"),
                Arguments.of("dangling edge", definition(List.of(manual("manual")),
                        List.of(edge("e1", "manual", "missing"))), "DANGLING_EDGE"),
                Arguments.of("cycle", definition(
                        List.of(manual("manual"), node("request", "http.request", httpConfig()),
                                node("extract", "ai.extract", Map.of("text", "hello"))),
                        List.of(edge("e1", "manual", "request"), edge("e2", "request", "extract"),
                                edge("e3", "extract", "request"))), "CYCLE_DETECTED"),
                Arguments.of("unreachable action", definition(
                        List.of(manual("manual"), node("request", "http.request", httpConfig())), List.of()),
                        "UNREACHABLE_NODE"),
                Arguments.of("incoming trigger edge", definition(
                        List.of(manual("manual"), node("request", "http.request", httpConfig()),
                                node("webhook", "trigger.webhook", Map.of())),
                        List.of(edge("e1", "manual", "request"), edge("e2", "request", "webhook"))),
                        "TRIGGER_HAS_INCOMING_EDGE"),
                Arguments.of("missing manual root", definition(
                        List.of(node("webhook", "trigger.webhook", Map.of())), List.of()),
                        "MANUAL_TRIGGER_REQUIRED"),
                Arguments.of("multiple manual roots", definition(
                        List.of(manual("manual1"), manual("manual2")), List.of()),
                        "MULTIPLE_MANUAL_TRIGGERS"),
                Arguments.of("removed catalog type", definition(
                        List.of(manual("manual"), node("agent", "agent.task", Map.of())), List.of()),
                        "UNKNOWN_NODE_TYPE"),
                Arguments.of("invalid source port", definition(
                        List.of(manual("manual"), node("request", "http.request", httpConfig())),
                        List.of(new WorkflowDefinition.Edge("e1", "manual", "request", "true"))),
                        "INVALID_SOURCE_PORT"),
                Arguments.of("invalid schema version", new WorkflowDefinition("2.0", List.of(manual("manual")),
                        List.of(), Map.of()), "INVALID_SCHEMA_VERSION"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"agent.task", "google.docs"})
    void rejectsRemovedTypesDuringDraftSave(String type) {
        var graph = definition(List.of(manual("manual"), node("removed", type, Map.of())), List.of());

        assertTrue(validator.validateDraft(graph).stream()
                .anyMatch(issue -> issue.nodeId().equals("removed") && issue.code().equals("UNKNOWN_NODE_TYPE")));
    }

    @Test
    void exposesExactlyTheThirteenSupportedV1NodeTypes() {
        assertEquals(Set.of("trigger.manual", "trigger.schedule", "trigger.webhook", "trigger.telegram",
                "http.request", "email.send", "google.sheets", "telegram.send_message", "logic.condition",
                "ai.extract", "ai.classify", "ai.summarize", "ocr.extract"), NodeCatalog.supportedTypes());
    }

    @Test
    void rejectsWhitespaceOnlyNodeAndEdgeIdentifiers() {
        WorkflowDefinition graph = definition(
                List.of(manual(" \t")),
                List.of(new WorkflowDefinition.Edge("edge", " \n", "target", null)));

        List<ValidationIssue> issues = validator.validateDraft(graph);

        assertTrue(issues.stream().anyMatch(issue -> "INVALID_NODE_ID".equals(issue.code())));
        assertTrue(issues.stream().anyMatch(issue -> "INVALID_EDGE_SOURCE".equals(issue.code())));
    }

    @Test
    void definitionCopiesItsListsAndVariablesIntoImmutableSnapshots() {
        var sourceNodes = new ArrayList<>(List.of(manual("manual")));
        var sourceEdges = new ArrayList<>(List.of(edge("e1", "manual", "next")));
        var nestedVariables = new LinkedHashMap<String, Object>();
        nestedVariables.put("region", "west");
        var sourceVariables = new LinkedHashMap<String, Object>();
        sourceVariables.put("settings", nestedVariables);

        WorkflowDefinition definition = new WorkflowDefinition("1.0", sourceNodes, sourceEdges, sourceVariables);
        sourceNodes.clear();
        sourceEdges.clear();
        nestedVariables.put("region", "changed");

        assertEquals(1, definition.nodes().size());
        assertEquals(1, definition.edges().size());
        assertEquals("west", ((Map<?, ?>) definition.variables().get("settings")).get("region"));
        assertThrows(UnsupportedOperationException.class, () -> definition.nodes().clear());
        assertThrows(UnsupportedOperationException.class, () -> definition.edges().clear());
        assertThrows(UnsupportedOperationException.class, () -> definition.variables().put("new", true));
    }

    @Test
    void validatesCompleteConfigurationForSupportedNonScheduleTypes() {
        UUID connectionId = UUID.randomUUID();
        List<WorkflowDefinition.Node> nodes = List.of(
                manual("manual"),
                node("webhook", "trigger.webhook", Map.of()),
                node("telegram-trigger", "trigger.telegram", Map.of()),
                node("request", "http.request", httpConfig()),
                node("email", "email.send", Map.of("to", "person@example.test", "subject", "Ready", "body", "Done")),
                node("sheets", "google.sheets", Map.of("connectionId", connectionId.toString(), "operation", "read",
                        "spreadsheetId", "sheet-id", "range", "Sheet1!A1")),
                node("telegram-send", "telegram.send_message", Map.of("chatId", "123", "text", "Done")),
                node("condition", "logic.condition", Map.of("left", 1, "operator", "eq", "right", 1)),
                node("extract", "ai.extract", Map.of("text", "Read this")),
                node("classify", "ai.classify", Map.of("content", "Read this")),
                node("summarize", "ai.summarize", Map.of("inputText", "Read this", "maxLength", 200)),
                node("ocr", "ocr.extract", Map.of("artifactId", "artifact-1")));
        List<WorkflowDefinition.Edge> edges = new ArrayList<>();
        for (String target : List.of("request", "email", "sheets", "telegram-send", "condition", "extract",
                "classify", "summarize", "ocr")) {
            edges.add(edge("manual-to-" + target, "manual", target));
        }
        var graph = definition(nodes, edges);

        assertTrue(new DefinitionValidator((nodeId, cron, timezone) -> List.of()).validatePublish(graph).isEmpty());
    }

    @Test
    void failsClosedWhenScheduleValidationIsUnavailable() {
        var graph = definition(List.of(manual("manual"), node("schedule", "trigger.schedule",
                Map.of("cron", "0 0 9 * * *", "timezone", "Asia/Ho_Chi_Minh"))), List.of());

        assertTrue(validator.validatePublish(graph).stream()
                .anyMatch(issue -> issue.nodeId().equals("schedule")
                        && issue.code().equals("SCHEDULE_VALIDATION_UNAVAILABLE")));
        assertTrue(new DefinitionValidator((nodeId, cron, timezone) -> List.of()).validatePublish(graph).isEmpty());
    }

    @Test
    void requiresOneNonblankOcrSourceAtPublish() {
        var graph = definition(List.of(manual("manual"),
                node("ocr", "ocr.extract", Map.of("artifactId", " "))), List.of());

        assertTrue(validator.validatePublish(graph).stream()
                .anyMatch(issue -> issue.nodeId().equals("ocr") && issue.code().equals("OCR_SOURCE_REQUIRED")));
    }

    @Test
    void optionalHttpConnectionAndRequiredSheetsConnectionMustBeLiteralUuids() {
        var httpWithoutConnection = definition(List.of(manual("manual"),
                node("request", "http.request", httpConfig())), List.of(edge("e1", "manual", "request")));
        assertTrue(validator.validateDraft(httpWithoutConnection).isEmpty());

        var sheetsDraft = definition(List.of(manual("manual"), node("sheets", "google.sheets", Map.of())), List.of());
        assertTrue(validator.validateDraft(sheetsDraft).isEmpty());
        assertTrue(validator.validatePublish(sheetsDraft).stream()
                .anyMatch(issue -> issue.nodeId().equals("sheets") && issue.field().equals("config.connectionId")
                        && issue.code().equals("REQUIRED_FIELD_MISSING")));

        var mappedHttpConnection = definition(List.of(manual("manual"), node("request", "http.request",
                Map.of("connectionId", "{{ variables.connectionId }}"))), List.of());
        var mappedSheetsConnection = definition(List.of(manual("manual"), node("sheets", "google.sheets",
                Map.of("connectionId", "{{ variables.connectionId }}"))), List.of());
        assertTrue(validator.validateDraft(mappedHttpConnection).stream()
                .anyMatch(issue -> issue.nodeId().equals("request")
                        && issue.code().equals("INVALID_CONNECTION_ID")));
        assertTrue(validator.validateDraft(mappedSheetsConnection).stream()
                .anyMatch(issue -> issue.nodeId().equals("sheets")
                        && issue.code().equals("INVALID_CONNECTION_ID")));
    }

    @Test
    void acceptsOnlyTrueAndFalsePortsForConditionEdges() {
        var graph = definition(List.of(
                manual("manual"),
                node("condition", "logic.condition", Map.of("left", 1, "operator", "eq", "right", 1)),
                node("yes", "ai.extract", Map.of("text", "yes")),
                node("no", "ai.extract", Map.of("text", "no"))),
                List.of(edge("start", "manual", "condition"),
                        new WorkflowDefinition.Edge("yes-edge", "condition", "yes", "true"),
                        new WorkflowDefinition.Edge("no-edge", "condition", "no", "false")));

        assertTrue(validator.validatePublish(graph).isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {"authorization", "COOKIE", "X-aPi-KeY"})
    void rejectsSensitiveHttpHeadersCaseInsensitivelyWithoutEchoingValues(String headerName) {
        String secretValue = "very-sensitive-test-value";
        var request = node("request", "http.request", Map.of("headers", Map.of(headerName, secretValue)));

        List<ValidationIssue> issues = validator.validateDraft(definition(List.of(manual("manual"), request), List.of()));
        ValidationIssue issue = issues.stream().filter(i -> i.code().equals("CREDENTIAL_FIELD_NOT_ALLOWED"))
                .findFirst().orElseThrow();

        assertFalse(issue.toString().contains(secretValue));
        assertFalse(issue.message().contains(headerName));
    }

    @Test
    void rejectsNestedCredentialFieldsAndUrlUserInfoWithoutEchoingInput() {
        String secretValue = "not-for-diagnostics";
        var nested = new LinkedHashMap<String, Object>();
        nested.put("password", secretValue);
        var credentialField = node("request", "http.request", Map.of("body", nested));
        var userInfo = node("other-request", "http.request",
                Map.of("url", "https://person:" + secretValue + "@example.test/resource"));
        var ocrUserInfo = node("ocr", "ocr.extract",
                Map.of("fileUrl", "https://person:" + secretValue + "@example.test/file"));

        List<ValidationIssue> issues = validator.validateDraft(definition(
                List.of(manual("manual"), credentialField, userInfo, ocrUserInfo), List.of()));

        assertTrue(issues.stream().anyMatch(issue -> issue.code().equals("CREDENTIAL_FIELD_NOT_ALLOWED")));
        assertTrue(issues.stream().anyMatch(issue -> issue.code().equals("URL_USERINFO_NOT_ALLOWED")));
        assertTrue(issues.stream().anyMatch(issue -> issue.nodeId().equals("ocr")
                && issue.code().equals("URL_USERINFO_NOT_ALLOWED")));
        assertTrue(issues.stream().noneMatch(issue -> issue.toString().contains(secretValue)));
    }

    @Test
    void draftRejectsInvalidCatalogValuesAndConflictingOcrSourcesWithoutGraphValidation() {
        var graph = definition(List.of(
                manual("manual"),
                node("sheets", "google.sheets", Map.of("operation", "delete")),
                node("condition", "logic.condition", Map.of("operator", "run-code")),
                node("summary", "ai.summarize", Map.of("maxLength", 0)),
                node("ocr", "ocr.extract", Map.of("artifactId", "artifact", "fileUrl", "https://example.test/file"))),
                List.of(new WorkflowDefinition.Edge("port", "manual", "summary", "next")));

        List<ValidationIssue> issues = validator.validateDraft(graph);

        assertTrue(issues.stream().anyMatch(issue -> issue.code().equals("INVALID_SHEETS_OPERATION")));
        assertTrue(issues.stream().anyMatch(issue -> issue.code().equals("INVALID_CONDITION_OPERATOR")));
        assertTrue(issues.stream().anyMatch(issue -> issue.code().equals("INVALID_FIELD_TYPE")
                && "config.maxLength".equals(issue.field())));
        assertTrue(issues.stream().anyMatch(issue -> issue.code().equals("OCR_SOURCE_CONFLICT")));
        assertTrue(issues.stream().anyMatch(issue -> issue.code().equals("INVALID_SOURCE_PORT")));
        assertFalse(issues.stream().anyMatch(issue -> issue.code().equals("UNREACHABLE_NODE")));
    }

    @Test
    void enforcesNodeAndEdgeBoundsOnDrafts() {
        List<WorkflowDefinition.Node> tooManyNodes = new ArrayList<>();
        for (int i = 0; i <= 200; i++) {
            tooManyNodes.add(manual("manual-" + i));
        }
        List<WorkflowDefinition.Edge> tooManyEdges = new ArrayList<>();
        for (int i = 0; i <= 1000; i++) {
            tooManyEdges.add(edge("edge-" + i, "manual", "manual"));
        }

        assertTrue(validator.validateDraft(definition(tooManyNodes, List.of())).stream()
                .anyMatch(issue -> issue.code().equals("TOO_MANY_NODES")));
        assertTrue(validator.validateDraft(definition(List.of(manual("manual")), tooManyEdges)).stream()
                .anyMatch(issue -> issue.code().equals("TOO_MANY_EDGES")));
    }

    @Test
    void acceptsNodeAndEdgeCountsAtTheirConfiguredLimits() {
        List<WorkflowDefinition.Node> maximumNodes = new ArrayList<>();
        for (int i = 0; i < DefinitionValidator.MAX_NODES; i++) {
            maximumNodes.add(manual("manual-" + i));
        }
        List<WorkflowDefinition.Edge> maximumEdges = new ArrayList<>();
        for (int i = 0; i < DefinitionValidator.MAX_EDGES; i++) {
            maximumEdges.add(edge("edge-" + i, "manual", "target"));
        }

        assertTrue(validator.validateDraft(definition(maximumNodes, List.of())).isEmpty());
        assertTrue(validator.validateDraft(definition(List.of(manual("manual")), maximumEdges)).isEmpty());
    }

    @Test
    void enforcesDefinitionByteBoundOnDomainDrafts() {
        var oversized = definition(List.of(manual("manual"), node("extract", "ai.extract",
                Map.of("text", "x".repeat(1_050_000)))), List.of());

        assertTrue(validator.validateDraft(oversized).stream()
                .anyMatch(issue -> issue.code().equals("DEFINITION_TOO_LARGE")));
    }

    @Test
    void acceptsDomainDefinitionAtTheUtf8ByteLimit() {
        int fixedBytes = 66;
        WorkflowDefinition atLimit = new WorkflowDefinition("1.0", List.of(), List.of(),
                Map.of("x", "x".repeat(DefinitionValidator.MAX_DEFINITION_BYTES - fixedBytes)));

        assertTrue(validator.validateDraft(atLimit).isEmpty());
    }

    @Test
    void acceptsTheMaximumJsonValueDepth() {
        assertDoesNotThrow(() -> node("request", "http.request",
                Map.of("body", nestedObject(30))));
    }

    @Test
    void rejectsOverDepthJsonBeforeRecursiveSnapshotCopy() {
        assertThrows(IllegalArgumentException.class,
                () -> node("request", "http.request",
                        Map.of("body", nestedObject(31))));
    }

    @Test
    void appliesJsonDepthLimitToTheWholeDefinitionEnvelope() {
        assertDoesNotThrow(() -> definition(List.of(manual("manual"), node("request", "http.request",
                Map.of("body", nestedObject(27)))), List.of()));
        assertThrows(IllegalArgumentException.class, () -> definition(List.of(manual("manual"),
                node("request", "http.request", Map.of("body", nestedObject(28)))), List.of()));
    }

    @Test
    void draftsKeepIncompleteMappingsEditableWhilePublishRejectsMalformedMappings() {
        WorkflowDefinition draft = definition(List.of(
                manual("manual"),
                node("request", "http.request", Map.of(
                        "method", "POST",
                        "url", "https://example.test/resource",
                        "body", Map.of("message", "{{ trigger.input.message")))),
                List.of(edge("start", "manual", "request")));

        assertFalse(validator.validateDraft(draft).stream().anyMatch(issue -> issue.code().equals("MAPPING_ERROR")));
        assertTrue(validator.validatePublish(draft).stream().anyMatch(issue -> issue.nodeId().equals("request")
                && issue.field().equals("config.body") && issue.code().equals("MAPPING_ERROR")));
    }

    @Test
    void allowsMappingsForTypedAndEnumFieldsUntilTheirResolvedValuesCanBeChecked() {
        var variables = new LinkedHashMap<String, Object>();
        variables.put("limit", 250);
        variables.put("method", "POST");
        variables.put("headers", Map.of("Accept", "application/json"));
        WorkflowDefinition graph = new WorkflowDefinition("1.0", List.of(
                manual("manual"),
                node("summary", "ai.summarize", Map.of(
                        "inputText", "Summarize this",
                        "maxLength", "{{ variables.limit }}")),
                node("request", "http.request", Map.of(
                        "method", "{{ variables.method }}",
                        "url", "https://example.test/resource",
                        "headers", "{{ variables.headers }}"))),
                List.of(edge("summary", "manual", "summary"), edge("request", "manual", "request")),
                variables);

        assertTrue(validator.validateDraft(graph).isEmpty());
        assertTrue(validator.validatePublish(graph).isEmpty());
    }

    @Test
    void publishRequiresEveryNodeReferenceToBeAStaticUpstreamAncestor() {
        var graph = definition(List.of(
                manual("manual"),
                node("producer", "ai.summarize", Map.of("inputText", "source")),
                node("side-branch", "ai.summarize", Map.of("inputText", "side")),
                node("consumer", "ai.extract", Map.of("text", "{{ nodes.side-branch.output.summary }}"))),
                List.of(edge("start-producer", "manual", "producer"),
                        edge("start-side", "manual", "side-branch"),
                        edge("producer-consumer", "producer", "consumer")));

        List<ValidationIssue> issues = validator.validatePublish(graph);

        assertTrue(issues.stream().anyMatch(issue -> issue.nodeId().equals("consumer")
                && issue.field().equals("config.text") && issue.code().equals("MAPPING_ERROR")));
    }

    @Test
    void publishAcceptsDottedNodeIdsWhenTheGraphIdentifiesOneReference() {
        var graph = definition(List.of(
                manual("manual"),
                node("http.v1", "http.request", httpConfig()),
                node("consumer", "ai.extract", Map.of("text", "{{ nodes.http.v1.output.data.status }}"))),
                List.of(edge("start", "manual", "http.v1"), edge("next", "http.v1", "consumer")));

        assertTrue(validator.validatePublish(graph).isEmpty());
    }

    @Test
    void publishRejectsUnknownAndAmbiguousDottedNodeReferences() {
        var unknown = definition(List.of(manual("manual"),
                node("consumer", "ai.extract", Map.of("text", "{{ nodes.missing.output.value }}"))),
                List.of(edge("next", "manual", "consumer")));
        assertTrue(validator.validatePublish(unknown).stream()
                .anyMatch(issue -> issue.nodeId().equals("consumer") && issue.code().equals("MAPPING_ERROR")));

        var ambiguous = definition(List.of(manual("manual"),
                node("source", "ai.extract", Map.of("text", "first")),
                node("source.output", "ai.extract", Map.of("text", "second")),
                node("consumer", "ai.extract", Map.of("text", "{{ nodes.source.output.output.value }}"))),
                List.of(edge("root-source", "manual", "source"),
                        edge("root-dotted-source", "manual", "source.output"),
                        edge("source-consumer", "source", "consumer"),
                        edge("dotted-source-consumer", "source.output", "consumer")));
        assertTrue(validator.validatePublish(ambiguous).stream()
                .anyMatch(issue -> issue.nodeId().equals("consumer") && issue.code().equals("MAPPING_ERROR")));
    }

    private static WorkflowDefinition definition(List<WorkflowDefinition.Node> nodes,
            List<WorkflowDefinition.Edge> edges) {
        return new WorkflowDefinition("1.0", nodes, edges, Map.of());
    }

    private static WorkflowDefinition.Node manual(String id) {
        return node(id, "trigger.manual", Map.of());
    }

    private static WorkflowDefinition.Node node(String id, String type, Map<String, Object> config) {
        return new WorkflowDefinition.Node(id, type, config);
    }

    private static WorkflowDefinition.Edge edge(String id, String source, String target) {
        return new WorkflowDefinition.Edge(id, source, target, null);
    }

    private static Map<String, Object> httpConfig() {
        return Map.of("method", "GET", "url", "https://example.test/resource");
    }

    private static Map<String, Object> nestedObject(int nestedMaps) {
        Object value = "leaf";
        for (int i = 0; i < nestedMaps; i++) {
            value = Map.of("child", value);
        }
        return Map.of("body", value);
    }
}
