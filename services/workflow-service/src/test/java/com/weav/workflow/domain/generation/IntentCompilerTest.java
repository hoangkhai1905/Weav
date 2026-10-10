package com.weav.workflow.domain.generation;

import com.weav.workflow.domain.definition.DefinitionValidator;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

class IntentCompilerTest {
    private final IntentCompiler compiler = new IntentCompiler(new DefinitionValidator());

    private static Map<String, Object> node(String id, String type, Map<String, Object> config) {
        return Map.of("id", id, "type", type, "config", config);
    }

    private static Map<String, Object> edge(String from, String to) {
        return Map.of("from", from, "to", to);
    }

    private static Map<String, Object> intent(List<Object> nodes, List<Object> edges) {
        return Map.of("name", "Generated", "nodes", nodes, "edges", edges);
    }

    private static final Map<String, Object> GET = Map.of("method", "GET", "url", "https://example.com");

    private static final Map<String, Object> PING = intent(
            List.of(node("start", "trigger.manual", Map.of()),
                    node("ping", "http.request", GET),
                    node("sum", "ai.summarize", Map.of("inputText", "{{nodes.ping.output.body}}", "maxLength", 100))),
            List.of(edge("start", "ping"), edge("ping", "sum")));

    @Test
    void compilesAValidIntentWithDeterministicLayout() {
        IntentCompiler.Ready ready = assertInstanceOf(IntentCompiler.Ready.class, compiler.compile(PING, Map.of()));
        assertEquals(List.of("start", "ping", "sum"), ready.definition().nodes().stream().map(n -> n.id()).toList());
        assertEquals(new IntentCompiler.Position(100, 100), ready.layout().get("start"));
        assertEquals(new IntentCompiler.Position(700, 100), ready.layout().get("sum"));
        assertEquals(ready, compiler.compile(PING, Map.of()));
    }

    @Test
    void rejectsCyclesUnsafeReferencesUnknownTypesIntentConnectionIdsAndMissingFacts() {
        List<Map<String, Object>> invalid = List.of(
                intent(List.of(node("start", "trigger.manual", Map.of()), node("a", "http.request", GET), node("b", "http.request", GET)),
                        List.of(edge("start", "a"), edge("a", "b"), edge("b", "a"))),
                intent(List.of(node("start", "trigger.manual", Map.of()),
                        node("a", "ai.summarize", Map.of("inputText", "{{nodes.b.output.x}}")), node("b", "http.request", GET)),
                        List.of(edge("start", "a"), edge("a", "b"))),
                intent(List.of(node("start", "trigger.manual", Map.of()), node("a", "agent.task", Map.of())), List.of(edge("start", "a"))),
                intent(List.of(node("start", "trigger.manual", Map.of()), node("a", "http.request",
                        Map.of("method", "GET", "url", "https://e.com", "connectionId", UUID.randomUUID().toString()))),
                        List.of(edge("start", "a"))),
                intent(List.of(node("Start!", "trigger.manual", Map.of()), node("a", "http.request", GET)), List.of(edge("Start!", "a"))));
        for (Map<String, Object> candidate : invalid) {
            assertInstanceOf(IntentCompiler.Invalid.class, compiler.compile(candidate, Map.of()), candidate.toString());
        }
        assertInstanceOf(IntentCompiler.Invalid.class, compiler.compile("not an object", Map.of()));
    }

    @Test
    void aScheduleWithoutAManualTriggerAsksForItsTimezoneAndCompilesOnceGiven() {
        Map<String, Object> schedule = intent(
                List.of(node("start", "trigger.schedule", Map.of("cron", "0 0 9 * * *")), node("a", "http.request", GET)),
                List.of(edge("start", "a")));
        assertEquals(new IntentCompiler.NeedsValues(List.of(new IntentCompiler.Missing("trigger.schedule", "timezone"))),
                compiler.compile(schedule, Map.of()));

        Map<String, Object> withTimezone = intent(
                List.of(node("start", "trigger.schedule", Map.of("cron", "0 0 9 * * *", "timezone", "Asia/Ho_Chi_Minh")),
                        node("a", "http.request", GET)),
                List.of(edge("start", "a")));
        IntentCompiler withScheduleValidation = new IntentCompiler(new DefinitionValidator((nodeId, cron, timezone) -> List.of()));
        assertInstanceOf(IntentCompiler.Ready.class, withScheduleValidation.compile(withTimezone, Map.of()));
    }

    @Test
    void asksForAMissingConnectionAndBindsAPickedOne() {
        Map<String, Object> sheets = intent(
                List.of(node("start", "trigger.manual", Map.of()),
                        node("read", "google.sheets", Map.of("operation", "read", "spreadsheetId", "abc", "range", "A1:B2"))),
                List.of(edge("start", "read")));
        assertEquals(new IntentCompiler.NeedsConnections(List.of("google.sheets")), compiler.compile(sheets, Map.of()));

        UUID picked = UUID.randomUUID();
        IntentCompiler.Ready ready = assertInstanceOf(IntentCompiler.Ready.class,
                compiler.compile(sheets, Map.of("google.sheets", picked)));
        assertEquals(picked.toString(), ready.definition().nodes().get(1).config().get("connectionId"));
    }

    private Map<String, Object> mail(Map<String, Object>... emails) {
        List<Object> nodes = new java.util.ArrayList<>(List.of(node("start", "trigger.manual", Map.of())));
        nodes.addAll(List.of(emails));
        return intent(nodes, List.of(edge("start", (String) emails[0].get("id"))));
    }

    private Map<String, Object> mailNode(String id, Map<String, Object> config) {
        return node(id, "email.send", config);
    }

    private Object toOf(IntentCompiler.Compilation c, int index) {
        return assertInstanceOf(IntentCompiler.Ready.class, c).definition().nodes().get(index).config().get("to");
    }

    private static final Map<String, UUID> MAIL_CONNECTION = Map.of("email.send", UUID.randomUUID());

    @Test
    @SuppressWarnings("unchecked")
    void answerForARenamedNodeIdFillsTheOnlyNodeWithThatEmptyField() {
        Map<String, Object> intent = mail(mailNode("gui_email", Map.of("subject", "Hi", "body", "b")));
        assertEquals("a@example.test", toOf(compiler.compile(intent, MAIL_CONNECTION,
                Map.of("send_email.config.to", "a@example.test")), 1));
    }

    @Test
    @SuppressWarnings("unchecked")
    void answerForAnUnknownNodeIdIsIgnoredWhenSeveralNodesQualify() {
        Map<String, Object> intent = intent(
                List.of(node("start", "trigger.manual", Map.of()),
                        mailNode("m1", Map.of("subject", "Hi", "body", "b")),
                        mailNode("m2", Map.of("subject", "Hi", "body", "b"))),
                List.of(edge("start", "m1"), edge("m1", "m2")));
        assertInstanceOf(IntentCompiler.NeedsValues.class,
                compiler.compile(intent, MAIL_CONNECTION, Map.of("send_email.config.to", "a@example.test")));
    }

    @Test
    @SuppressWarnings("unchecked")
    void answerNeverOverwritesAFilledValueNorMatchesExactIdOrTypeKeysLess() {
        Map<String, Object> intent = mail(mailNode("gui_email", Map.of("to", "keep@example.test", "subject", "Hi", "body", "b")));
        assertEquals("keep@example.test", toOf(compiler.compile(intent, MAIL_CONNECTION,
                Map.of("send_email.config.to", "a@example.test")), 1));
        assertEquals("keep@example.test", toOf(compiler.compile(intent, MAIL_CONNECTION,
                Map.of("gui_email.config.to", "a@example.test", "email.send.to", "b@example.test")), 1));

        Map<String, Object> empty = mail(mailNode("gui_email", Map.of("subject", "Hi", "body", "b")));
        assertEquals("a@example.test", toOf(compiler.compile(empty, MAIL_CONNECTION,
                Map.of("gui_email.config.to", "a@example.test")), 1));
        assertEquals("b@example.test", toOf(compiler.compile(empty, MAIL_CONNECTION,
                Map.of("email.send.to", "b@example.test")), 1));
    }
}
