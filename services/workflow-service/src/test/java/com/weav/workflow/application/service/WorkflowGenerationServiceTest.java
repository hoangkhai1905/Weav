package com.weav.workflow.application.service;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.AiGenerationPort;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.domain.definition.DefinitionValidator;
import com.weav.workflow.domain.exception.AiTimeoutException;
import com.weav.workflow.domain.exception.AiUnavailableException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.domain.exception.GenerationRateLimitedException;
import com.weav.workflow.domain.generation.IntentCompiler;
import org.junit.jupiter.api.Test;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

class WorkflowGenerationServiceTest {
    private static final UUID WORKSPACE = UUID.randomUUID();
    private static final UUID ACTOR = UUID.randomUUID();
    private static final Map<String, Object> PING = Map.of("name", "Generated",
            "nodes", List.of(node("start", "trigger.manual", Map.of()),
                    node("ping", "http.request", Map.of("method", "GET", "url", "https://example.com")),
                    node("sum", "ai.summarize", Map.of("inputText", "{{nodes.ping.output.body}}", "maxLength", 100))),
            "edges", List.of(edge("start", "ping"), edge("ping", "sum")));

    @Test void readyIntentReturnsNameDefinitionAndLayout() {
        FakeAi ai = new FakeAi(Map.of("status", "ready", "intent", PING));
        Map<String, Object> result = service(ai, new Connections(), () -> true)
                .generate(WORKSPACE, ACTOR, "ping", null, Map.of());
        assertEquals("ready", result.get("status"));
        assertEquals("Generated", result.get("name"));
        assertEquals(3, ((com.weav.workflow.domain.definition.WorkflowDefinition) result.get("definition")).nodes().size());
        assertEquals(Map.of("x", 100, "y", 100), ((Map<?, ?>) result.get("layout")).get("start"));
    }

    @Test void passesNeedsInputAndUnsupportedThroughAfterRevalidatingCodes() {
        FakeAi ai = new FakeAi(Map.of("status", "needs_input", "questions",
                List.of(Map.of("code", "URL", "field", "http.request.url"))),
                Map.of("status", "unsupported", "reasons", List.of(Map.of("code", "OUT_OF_SCOPE"))));
        WorkflowGenerationService service = service(ai, new Connections(), () -> true);
        assertEquals("needs_input", service.generate(WORKSPACE, ACTOR, "x", null, Map.of()).get("status"));
        assertEquals("unsupported", service.generate(WORKSPACE, ACTOR, "x", null, Map.of()).get("status"));
    }

    @Test void unknownQuestionCodeBecomesInvalidIntent() {
        Map<String, Object> result = service(new FakeAi(Map.of("status", "needs_input",
                "questions", List.of(Map.of("code", "PLEASE", "field", "x")))), new Connections(), () -> true)
                .generate(WORKSPACE, ACTOR, "x", null, Map.of());
        assertEquals("INVALID_INTENT", ((Map<?, ?>) ((List<?>) result.get("reasons")).get(0)).get("code"));
    }

    @Test void missingConnectionBecomesConnectionQuestion() {
        Map<String, Object> sheets = Map.of("name", "Sheets", "nodes", List.of(
                node("start", "trigger.manual", Map.of()),
                node("read", "google.sheets", Map.of("operation", "read", "spreadsheetId", "a", "range", "A1"))),
                "edges", List.of(edge("start", "read")));
        Map<String, Object> result = service(new FakeAi(Map.of("status", "ready", "intent", sheets)),
                new Connections(), () -> true).generate(WORKSPACE, ACTOR, "x", null, Map.of());
        assertEquals("needs_input", result.get("status"));
        assertEquals(Map.of("code", "CONNECTION", "field", "google.sheets"),
                ((List<?>) result.get("questions")).get(0));
    }

    @Test void invalidCompiledIntentBecomesInvalidIntent() {
        Map<String, Object> cycle = Map.of("name", "Bad", "nodes", List.of(
                node("start", "trigger.manual", Map.of()), node("a", "http.request", Map.of("method", "GET", "url", "https://e")),
                node("b", "http.request", Map.of("method", "GET", "url", "https://e"))),
                "edges", List.of(edge("start", "a"), edge("a", "b"), edge("b", "a")));
        Map<String, Object> result = service(new FakeAi(Map.of("status", "ready", "intent", cycle)),
                new Connections(), () -> true).generate(WORKSPACE, ACTOR, "x", null, Map.of());
        assertEquals("INVALID_INTENT", ((Map<?, ?>) ((List<?>) result.get("reasons")).get(0)).get("code"));
    }

    private static Map<String, Object> emailWithoutBody() {
        return Map.of("name", "Mail", "nodes", List.of(
                node("start", "trigger.manual", Map.of()),
                node("send_email", "email.send", Map.of("to", "a@example.test", "subject", "Hi"))),
                "edges", List.of(edge("start", "send_email")));
    }

    @Test void missingRequiredTextBecomesValueQuestionBeforeConnectionQuestion() {
        Map<String, Object> result = service(new FakeAi(Map.of("status", "ready", "intent", emailWithoutBody())),
                new Connections(), () -> true).generate(WORKSPACE, ACTOR, "x", null, Map.of());
        assertEquals("needs_input", result.get("status"));
        assertEquals(List.of(Map.of("code", "VALUE", "field", "email.send.body")), result.get("questions"));
    }

    @Test void answersFillTheMissingValueAndAreSentToTheAi() {
        FakeAi ai = new FakeAi(Map.of("status", "ready", "intent", emailWithoutBody()));
        Map<String, Object> result = service(ai, new Connections(), () -> true).generate(WORKSPACE, ACTOR, "x", null,
                Map.of("email.send", UUID.randomUUID()), Map.of("email.send.body", "Hello there"));
        assertEquals("ready", result.get("status"));
        var definition = (com.weav.workflow.domain.definition.WorkflowDefinition) result.get("definition");
        assertEquals("Hello there", definition.nodes().get(1).config().get("body"));
        assertTrue(String.valueOf(ai.payload.get("prompt")).contains("email.send.body: Hello there"));
    }

    @Test void answerKeyedByNodeIdAlsoFillsAndNonTextFieldsAreNotAskable() {
        Map<String, Object> result = service(new FakeAi(Map.of("status", "ready", "intent", emailWithoutBody())),
                new Connections(), () -> true).generate(WORKSPACE, ACTOR, "x", null,
                Map.of("email.send", UUID.randomUUID()), Map.of("send_email.config.body", "Hello"));
        assertEquals("ready", result.get("status"));
        Map<String, Object> noValues = Map.of("name", "Sheets", "nodes", List.of(
                node("start", "trigger.manual", Map.of()),
                node("w", "google.sheets", Map.of("operation", "append", "spreadsheetId", "a", "range", "A1"))),
                "edges", List.of(edge("start", "w")));
        assertEquals("INVALID_INTENT", ((Map<?, ?>) ((List<?>) service(new FakeAi(Map.of("status", "ready",
                "intent", noValues)), new Connections(), () -> true).generate(WORKSPACE, ACTOR, "x", null,
                Map.of("google.sheets", UUID.randomUUID())).get("reasons")).get(0)).get("code"));
    }

    @Test void capabilitiesExcludeUnavailableTypesConnectionIdAndLegacySchemaDescription() {
        FakeAi ai = new FakeAi(Map.of("status", "unsupported", "reasons", List.of(Map.of("code", "OUT_OF_SCOPE"))));
        UUID connectionId = UUID.randomUUID();
        service(ai, new Connections(), () -> true).generate(WORKSPACE, ACTOR, "x", null,
                Map.of("google.sheets", connectionId));
        String payload = String.valueOf(ai.payload);
        assertFalse(payload.contains("trigger.telegram"), "no public base URL, so the trigger is unavailable");
        assertTrue(payload.contains("telegram.send_message"));
        assertFalse(payload.contains("connectionId"));
        assertFalse(payload.contains("schemaDescription"));
        assertFalse(payload.contains(connectionId.toString()));
        List<?> capabilities = (List<?>) ai.payload.get("capabilities");
        List<String> types = capabilities.stream().map(v -> (String) ((Map<?, ?>) v).get("type")).toList();
        List<String> sorted = new ArrayList<>(types);
        Collections.sort(sorted);
        assertEquals(sorted, types);
    }

    @Test void forbiddenWithoutWorkflowCreateAndBeforeCallingAi() {
        FakeAi ai = new FakeAi(Map.of());
        WorkspaceAuthorization auth = new WorkspaceAuthorization((w, u) ->
                new WorkspaceAccessPort.Access(w, u, "member", Set.of()));
        assertThrows(ForbiddenException.class, () -> service(auth, ai, new Connections(), () -> true)
                .generate(WORKSPACE, ACTOR, "x", null, Map.of()));
        assertEquals(0, ai.calls);
    }

    @Test void unattachableConnectionIsForbiddenBeforeCallingAi() {
        FakeAi ai = new FakeAi(Map.of());
        Connections connections = new Connections();
        connections.failure = new ForbiddenException();
        assertThrows(ForbiddenException.class, () -> service(ai, connections, () -> true)
                .generate(WORKSPACE, ACTOR, "x", null, Map.of("http.request", UUID.randomUUID())));
        assertEquals(0, ai.calls);
    }

    @Test void disabledFlagIsAiUnavailable() {
        FakeAi ai = new FakeAi(Map.of());
        assertThrows(AiUnavailableException.class, () -> service(ai, new Connections(), () -> false)
                .generate(WORKSPACE, ACTOR, "ping", null, Map.of()));
        assertEquals(0, ai.calls);
    }

    @Test void aiTimeoutAndTransportTimeoutBecomeAiTimeout() {
        for (String code : List.of("AI_TIMEOUT", "TIMEOUT")) {
            FakeAi ai = new FakeAi(new NodeExecutor.Failure(code, "failure", true));
            assertThrows(AiTimeoutException.class, () -> service(ai, new Connections(), () -> true)
                    .generate(UUID.randomUUID(), UUID.randomUUID(), "x", null, Map.of()));
        }
    }

    @Test void quotaExhaustionBecomesAiQuotaExceeded() {
        FakeAi ai = new FakeAi(new NodeExecutor.Failure("AI_QUOTA_EXCEEDED", "quota", false));
        assertThrows(com.weav.workflow.domain.exception.AiQuotaExceededException.class,
                () -> service(ai, new Connections(), () -> true)
                        .generate(UUID.randomUUID(), UUID.randomUUID(), "x", null, Map.of()));
    }

    @Test void otherAiFailuresBecomeAiUnavailable() {
        for (String code : List.of("DEPENDENCY_NOT_CONFIGURED", "AI_PROVIDER_UNAVAILABLE")) {
            FakeAi ai = new FakeAi(new NodeExecutor.Failure(code, "failure", false));
            assertThrows(AiUnavailableException.class, () -> service(ai, new Connections(), () -> true)
                    .generate(UUID.randomUUID(), UUID.randomUUID(), "x", null, Map.of()));
        }
    }

    @Test void unusableModelOutputBecomesInvalidIntentNotUnavailable() {
        FakeAi ai = new FakeAi(new NodeExecutor.Failure("AI_OUTPUT_INVALID", "failure", false));
        assertEquals(Map.of("status", "unsupported", "reasons", List.of(Map.of("code", "INVALID_INTENT"))),
                service(ai, new Connections(), () -> true).generate(UUID.randomUUID(), UUID.randomUUID(), "x", null, Map.of()));
    }

    @Test void sixthCallWithinAMinuteIsRateLimitedPerUserAndWorkspace() {
        FakeAi ai = new FakeAi(Map.of("status", "unsupported", "reasons", List.of(Map.of("code", "OUT_OF_SCOPE"))));
        WorkflowGenerationService service = service(ai, new Connections(), () -> true);
        for (int i = 0; i < 5; i++) service.generate(WORKSPACE, ACTOR, "x", null, Map.of());
        assertThrows(GenerationRateLimitedException.class, () -> service.generate(WORKSPACE, ACTOR, "x", null, Map.of()));
        assertDoesNotThrow(() -> service.generate(WORKSPACE, UUID.randomUUID(), "x", null, Map.of()));
    }

    private static WorkflowGenerationService service(FakeAi ai, Connections connections, BooleanSupplier enabled) {
        return service(new WorkspaceAuthorization((w, u) ->
                        new WorkspaceAccessPort.Access(w, u, "member", Set.of("WORKFLOW_CREATE"))),
                ai, connections, enabled);
    }

    private static WorkflowGenerationService service(WorkspaceAuthorization auth, FakeAi ai, Connections connections,
                                                     BooleanSupplier enabled) {
        return new WorkflowGenerationService(auth, connections, ai, new GenerationRateLimiter(),
                new IntentCompiler(new DefinitionValidator()), enabled);
    }

    private static Map<String, Object> node(String id, String type, Map<String, Object> config) {
        return Map.of("id", id, "type", type, "config", config);
    }
    private static Map<String, Object> edge(String from, String to) { return Map.of("from", from, "to", to); }
    private static Map<String, Object> edge(String from, String to, String port) {
        return Map.of("from", from, "to", to, "port", port);
    }

    @FunctionalInterface private interface BooleanSupplier extends java.util.function.BooleanSupplier {}

    @Test void capabilitiesOfferSwitchDataSetAndCondition() {
        List<Map<String, Object>> capabilities = WorkflowGenerationService.capabilities();
        List<String> types = capabilities.stream().map(capability -> (String) capability.get("type")).toList();
        assertTrue(types.contains("data.set"));
        assertTrue(types.contains("logic.condition"));
        Map<String, Object> sw = capabilities.stream()
                .filter(capability -> "logic.switch".equals(capability.get("type"))).findFirst().orElseThrow();
        assertEquals(List.of("cases", "value"), sw.get("configFields"));
    }

    @Test void switchIntentWithCaseAndDefaultPortsCompilesToValidDefinition() {
        Map<String, Object> intent = Map.of("name", "Route", "nodes", List.of(
                node("start", "trigger.manual", Map.of()),
                node("route", "logic.switch", Map.of("value", "{{trigger.input.kind}}", "cases", List.of("a", "b"))),
                node("one", "http.request", Map.of("method", "GET", "url", "https://example.com/a")),
                node("two", "http.request", Map.of("method", "GET", "url", "https://example.com/b")),
                node("other", "http.request", Map.of("method", "GET", "url", "https://example.com/c"))),
                "edges", List.of(edge("start", "route"), edge("route", "one", "a"),
                        edge("route", "two", "b"), edge("route", "other", "default")));
        Map<String, Object> result = service(new FakeAi(Map.of("status", "ready", "intent", intent)),
                new Connections(), () -> true).generate(WORKSPACE, ACTOR, "x", null, Map.of());
        assertEquals("ready", result.get("status"));
    }

    private static final class FakeAi implements AiGenerationPort {
        private final Deque<Object> responses = new ArrayDeque<>();
        private Map<String, Object> payload;
        private int calls;
        FakeAi(Object... responses) { this.responses.addAll(List.of(responses)); }
        public Map<String, Object> generate(UUID workspaceId, Map<String, Object> payload) {
            calls++; this.payload = payload;
            Object response = responses.isEmpty() ? Map.of("status", "unsupported",
                    "reasons", List.of(Map.of("code", "OUT_OF_SCOPE"))) : responses.removeFirst();
            if (response instanceof NodeExecutor.Failure failure) throw failure;
            return (Map<String, Object>) response;
        }
    }

    private static final class Connections implements WorkspaceConnectionPort {
        private RuntimeException failure;
        public void authorizeAttachment(UUID w, UUID c, UUID u) { if (failure != null) throw failure; }
        public ResolvedConnection resolve(UUID w, UUID c) { return null; }
        public void reportAuthenticationRejected(UUID w, UUID c) {}
    }
}
