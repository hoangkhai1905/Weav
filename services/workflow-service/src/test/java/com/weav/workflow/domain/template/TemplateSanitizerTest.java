package com.weav.workflow.domain.template;

import com.weav.workflow.domain.definition.NodeCatalog;
import com.weav.workflow.domain.definition.NodeConfigSchema;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.template.TemplateSanitizer.RemovedField;
import com.weav.workflow.domain.template.TemplateSanitizer.SanitizedTemplate;
import com.weav.workflow.domain.template.TemplateSanitizer.TemplateWarning;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TemplateSanitizerTest {
    private final TemplateSanitizer sanitizer = new TemplateSanitizer();

    private static WorkflowDefinition definition(WorkflowDefinition.Node... nodes) {
        return new WorkflowDefinition("1.0", List.of(nodes), List.of(), Map.of());
    }

    private static WorkflowDefinition.Node node(String id, String type, Object... keyValues) {
        Map<String, Object> config = new LinkedHashMap<>();
        for (int i = 0; i < keyValues.length; i += 2) {
            config.put((String) keyValues[i], keyValues[i + 1]);
        }
        return new WorkflowDefinition.Node(id, type, config);
    }

    private static Map<String, Object> config(SanitizedTemplate result, String nodeId) {
        return result.definition().nodes().stream().filter(n -> n.id().equals(nodeId)).findFirst().orElseThrow()
                .config();
    }

    @Test
    void removesConnectionIds() {
        SanitizedTemplate result = sanitizer.sanitize(definition(node("send_email", "email.send",
                "connectionId", "11111111-1111-1111-1111-111111111111", "subject", "Hi", "body", "Hello")), null);

        assertFalse(config(result, "send_email").containsKey("connectionId"));
        assertEquals("Hi", config(result, "send_email").get("subject"));
        assertTrue(result.removedFields().contains(new RemovedField("send_email", "connectionId")));
    }

    @Test
    void keepsPureExpressionPersonalField() {
        SanitizedTemplate single = sanitizer.sanitize(definition(node("mail", "email.send",
                "to", "{{ trigger.input.fromEmail }}")), null);
        assertEquals("{{ trigger.input.fromEmail }}", config(single, "mail").get("to"));

        SanitizedTemplate list = sanitizer.sanitize(definition(node("mail", "email.send",
                "to", List.of("{{ a.b }}", "{{ c.d }}"))), null);
        assertEquals(List.of("{{ a.b }}", "{{ c.d }}"), config(list, "mail").get("to"));
        assertTrue(list.removedFields().isEmpty());
    }

    @Test
    void removesLiteralAndMixedPersonalField() {
        SanitizedTemplate result = sanitizer.sanitize(definition(
                node("literal", "email.send", "to", "a@b.com"),
                node("mixed", "email.send", "to", "a@b.com, {{ trigger.input.to }}"),
                node("partial_list", "email.send", "to", List.of("{{ a.b }}", "x@y.com")),
                node("chat", "telegram.send_message", "chatId", 12345, "text", "hi")), null);

        assertFalse(config(result, "literal").containsKey("to"));
        assertFalse(config(result, "mixed").containsKey("to"));
        assertFalse(config(result, "partial_list").containsKey("to"));
        assertFalse(config(result, "chat").containsKey("chatId"));
        assertEquals("hi", config(result, "chat").get("text"));
        assertEquals(Set.of(new RemovedField("literal", "to"), new RemovedField("mixed", "to"),
                new RemovedField("partial_list", "to"), new RemovedField("chat", "chatId")),
                Set.copyOf(result.removedFields()));
    }

    @Test
    void blanksVariableValuesButKeepsKeys() {
        WorkflowDefinition source = new WorkflowDefinition("1.0", List.of(), List.of(),
                Map.of("apiBase", "https://x"));

        assertEquals(Map.of("apiBase", ""), sanitizer.sanitize(source, null).definition().variables());
    }

    @Test
    void editorStateKeepsOnlyNameAndPosition() {
        Map<String, Object> editorState = Map.of(
                "nodes", Map.of("n1", Map.of("name", "A", "position", Map.of("x", 1, "y", 2), "secret", "x")),
                "viewport", Map.of());

        Map<String, Object> result = sanitizer.sanitize(definition(), editorState).editorState();

        assertEquals(Map.of("nodes", Map.of("n1", Map.of("name", "A", "position", Map.of("x", 1, "y", 2)))), result);
        assertNull(sanitizer.sanitize(definition(), null).editorState());
    }

    @Test
    void warnsOnEmailAndTokenInFreeText() {
        SanitizedTemplate result = sanitizer.sanitize(definition(
                node("mail", "email.send", "subject", "Hi", "body", "Liên hệ sales@acme.vn"),
                node("call", "http.request", "method", "GET",
                        "url", "https://api.x.com/?k=AbCdEfGhIjKlMnOpQrStUvWxYz12"),
                node("quiet", "email.send", "subject", "Hi",
                        "body", "{{ nodes.prepare_long_node_identifier_name.output.x }}")), null);

        assertEquals(Set.of(new TemplateWarning("mail", "body", "EMAIL"), new TemplateWarning("call", "url", "TOKEN")),
                Set.copyOf(result.warnings()));
        assertEquals("Liên hệ sales@acme.vn", config(result, "mail").get("body"), "free text is not rewritten");
    }

    @Test
    void unknownNodeTypeFailsClosedNamingTheNode() {
        BadRequestException failure = assertThrows(BadRequestException.class, () -> sanitizer.sanitize(definition(
                node("x", "future.node", "note", "ping boss@x.com")), null));

        assertEquals("TEMPLATE_NODE_NOT_SHAREABLE", failure.getCode());
        assertTrue(failure.getMessage().contains("x"));
    }

    @Test
    void personalFieldMustBeAMappingPathNotAnyBraceContent() {
        SanitizedTemplate result = sanitizer.sanitize(definition(
                node("quoted", "email.send", "to", "{{ \"boss@x.com\" }}"),
                node("path", "email.send", "to", "{{ nodes.read-mail.output.items[0].from }}"),
                node("two", "email.send", "to", "{{ a.b }}{{ c.d }}")), null);

        assertFalse(config(result, "quoted").containsKey("to"));
        assertEquals("{{ nodes.read-mail.output.items[0].from }}", config(result, "path").get("to"));
        assertFalse(config(result, "two").containsKey("to"));
    }

    @Test
    void removesNestedMapsAndLiteralListsButKeepsMappedLists() {
        SanitizedTemplate result = sanitizer.sanitize(definition(
                node("call", "http.request", "method", "GET", "url", "https://x.test",
                        "headers", Map.of("Authorization", "Bearer abc"), "query", Map.of("id", "7")),
                node("cal", "google.calendar", "summary", "S", "attendees", List.of("a@b.com", "c@d.com")),
                node("cal2", "google.calendar", "summary", "S", "attendees", List.of("{{ a.b }}", "{{ c.d }}")),
                node("drive", "google.drive", "operation", "upload", "file", Map.of("fileId", "f1")),
                node("drive2", "google.drive", "operation", "upload", "file", "{{ trigger.input.attachments[0] }}")),
                null);

        assertFalse(config(result, "call").containsKey("headers"));
        assertFalse(config(result, "call").containsKey("query"));
        assertFalse(config(result, "cal").containsKey("attendees"));
        assertEquals(List.of("{{ a.b }}", "{{ c.d }}"), config(result, "cal2").get("attendees"));
        assertFalse(config(result, "drive").containsKey("file"));
        assertEquals("{{ trigger.input.attachments[0] }}", config(result, "drive2").get("file"));
    }

    @Test
    void editorStatePositionKeepsOnlyNumericXAndY() {
        Map<String, Object> state = Map.of("nodes", Map.of("n1", Map.of("name", "A",
                "position", Map.of("x", 1, "y", 2.5, "note", "boss@x.com"),
                "extra", "z"), "n2", Map.of("position", Map.of("x", "text", "y", 3))));

        Map<?, ?> nodes = (Map<?, ?>) sanitizer.sanitize(definition(), state).editorState().get("nodes");

        assertEquals(Map.of("name", "A", "position", Map.of("x", 1, "y", 2.5)), nodes.get("n1"));
        assertEquals(Map.of("position", Map.of("y", 3)), nodes.get("n2"));
    }

    /** Guard: a new node cannot add an id/recipient-like field without deciding how a shared template treats it. */
    @Test
    void everyIdLikeFieldIsClassified() {
        Set<String> allowed = Set.of("replyToMessageId", "messageId");
        Set<String> recipientNames = Set.of("to", "cc", "bcc", "email", "attendees", "headers");
        for (String type : NodeCatalog.supportedTypes()) {
            NodeConfigSchema schema = NodeCatalog.schema(type);
            for (String field : schema.fieldNames()) {
                if (!field.endsWith("Id") && !recipientNames.contains(field)) {
                    continue;
                }
                assertTrue(schema.connectionFields().contains(field) || schema.personalFields().contains(field)
                                || allowed.contains(field),
                        type + "." + field + " must be x-weav-connection, x-weav-personal or allow-listed");
            }
        }
    }
}
