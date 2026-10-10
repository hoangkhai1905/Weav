package com.weav.workflow.infrastructure.definition;

import com.weav.workflow.domain.definition.DefinitionValidator;
import com.weav.workflow.domain.definition.NodeCatalog;
import com.weav.workflow.domain.definition.NodeConfigSchema;
import com.weav.workflow.domain.definition.NodeConfigSchema.Field;
import com.weav.workflow.domain.definition.NodeConfigSchemas;
import com.weav.workflow.domain.definition.NodeSideEffects;
import com.weav.workflow.domain.definition.ValidationIssue;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Files;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class NodeConfigSchemasTest {
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private static final Set<String> TYPES = Set.of(
            "trigger.manual", "trigger.schedule", "trigger.webhook", "trigger.telegram", "http.request",
            "email.send", "google.sheets", "telegram.send_message", "logic.condition", "ai.extract",
            "ai.classify", "ai.summarize", "ocr.extract", "google.calendar", "google.drive", "logic.switch",
            "data.set", "ai.generate", "trigger.gmail");

    /** The publish-required fields the validator hard-coded before schemas drove it. */
    private static final Map<String, List<String>> REQUIRED = Map.ofEntries(
            Map.entry("trigger.schedule", List.of("cron", "timezone")),
            Map.entry("http.request", List.of("method", "url")),
            Map.entry("email.send", List.of("connectionId", "to", "subject", "body")),
            Map.entry("google.sheets", List.of("connectionId", "operation", "spreadsheetId", "range")),
            Map.entry("trigger.telegram", List.of("connectionId")),
            Map.entry("telegram.send_message", List.of("connectionId", "chatId", "text")),
            Map.entry("logic.condition", List.of()), // single or multi form: the validator requires the fields
            Map.entry("ai.extract", List.of("text")),
            Map.entry("ai.classify", List.of("content")),
            Map.entry("ai.summarize", List.of("inputText")),
            Map.entry("google.calendar", List.of("connectionId")), // summary/start/end: required for create only
            Map.entry("google.drive", List.of("connectionId", "operation")),
            Map.entry("logic.switch", List.of("value", "cases")),
            Map.entry("data.set", List.of("fields")),
            Map.entry("ai.generate", List.of("prompt")),
            Map.entry("trigger.gmail", List.of("connectionId")));

    @Test
    void registryLoadsAllThirteenNodeTypes() {
        assertEquals(TYPES, NodeConfigSchemas.all().keySet());
        assertEquals(TYPES, NodeCatalog.supportedTypes());
        assertEquals(Set.of("buttonLabel"), NodeCatalog.configFields("trigger.manual"));
        assertEquals(Set.of(), NodeCatalog.configFields("trigger.webhook"));
        assertEquals(Set.of("outputSchema"), NodeCatalog.staticFields("ai.extract"));
        assertEquals(Set.of(), NodeCatalog.staticFields("http.request"));
        for (String type : TYPES) {
            assertEquals(REQUIRED.getOrDefault(type, List.of()), NodeCatalog.schema(type).required(), type);
        }
    }


    /** Fields the removed isBlankRequiredString treated as blank-checked. */
    private static final Set<String> NON_BLANK = Set.of(
            "http.request.method", "http.request.url", "email.send.connectionId", "email.send.to",
            "email.send.subject", "google.sheets.connectionId", "google.sheets.operation",
            "google.sheets.spreadsheetId", "google.sheets.range", "telegram.send_message.connectionId",
            "telegram.send_message.chatId", "telegram.send_message.text", "trigger.telegram.connectionId",
            "trigger.schedule.cron", "trigger.schedule.timezone",
            "ai.extract.text", "ai.classify.content", "ai.summarize.inputText",
            "ocr.extract.artifactId", "ocr.extract.fileUrl", "google.calendar.connectionId",
            "google.calendar.summary", "google.calendar.start", "google.calendar.end",
            "google.drive.connectionId", "google.drive.operation", "ai.generate.prompt", "trigger.gmail.connectionId");

    private static Field field(String type, String name) {
        return NodeCatalog.schema(type).properties().get(name);
    }

    @Test
    void nonBlankFieldsEqualTheOldBlankRequiredStringList() {
        Set<String> actual = new LinkedHashSet<>();
        for (String type : TYPES) {
            NodeCatalog.schema(type).properties().forEach((name, f) -> {
                boolean minLength = f.minLength() != null && f.minLength() > 0
                        || f.oneOf().stream().anyMatch(b -> b.minLength() != null && b.minLength() > 0);
                if (minLength) {
                    actual.add(type + "." + name);
                }
            });
        }
        assertEquals(NON_BLANK, actual);
    }

    @Test
    void integerShapeMatchesOldPositiveIntegerCheck() {
        Field maxLength = field("ai.summarize", "maxLength");
        for (Object ok : List.of(new BigDecimal("2.0"), BigInteger.TEN, (byte) 1, (short) 3, 7, 9L)) {
            assertTrue(maxLength.matchesShape(ok), String.valueOf(ok));
        }
        for (Object bad : List.of(new BigDecimal("1.5"), 0, -1, 1.0d, "5", true)) {
            assertFalse(maxLength.matchesShape(bad), String.valueOf(bad));
        }
    }

    @Test
    void telegramChatIdAcceptsStringOrIntegerButBlankStringViolatesMinimum() {
        Field chatId = field("telegram.send_message", "chatId");
        assertTrue(chatId.matchesShape("@channel") && chatId.matchesShape(-1001234567890L) && chatId.matchesShape(7));
        assertFalse(chatId.matchesShape(true) || chatId.matchesShape(1.5d));
        assertTrue(chatId.violatesMinimumContent("  "));
        assertFalse(chatId.violatesMinimumContent(-1001234567890L));
    }

    @Test
    void blankContentIsDetectedForPublish() {
        Field to = field("email.send", "to");
        assertTrue(to.violatesMinimumContent(List.of()));
        assertTrue(to.violatesMinimumContent(List.of("", "a")));
        assertTrue(to.violatesMinimumContent("  "));
        assertFalse(to.violatesMinimumContent(List.of("a")));
        assertFalse(to.violatesMinimumContent("a@example.test"));
        assertFalse(to.violatesMinimumContent(5));
        assertTrue(to.matchesShape(List.of("a")) && to.matchesShape("a"));
        assertFalse(to.matchesShape(List.of(1)));
        assertTrue(field("email.send", "connectionId").violatesMinimumContent("  "));
        assertTrue(field("google.sheets", "connectionId").violatesMinimumContent(""));
        assertFalse(field("email.send", "body").violatesMinimumContent(" "));
    }

    @Test
    void blankEmailConnectionReportsMissingAndInvalid() {
        WorkflowDefinition definition = new WorkflowDefinition("1.0",
                List.of(new WorkflowDefinition.Node("manual", "trigger.manual", Map.of()),
                        new WorkflowDefinition.Node("email", "email.send", Map.of("connectionId", "  ",
                                "to", "a@example.test", "subject", "s", "body", "b"))),
                List.of(new WorkflowDefinition.Edge("e1", "manual", "email", null)), Map.of());
        List<String> codes = new DefinitionValidator().validatePublish(definition).stream()
                .map(ValidationIssue::code).toList();
        assertTrue(codes.contains("REQUIRED_FIELD_MISSING"), codes::toString);
        assertTrue(codes.contains("INVALID_CONNECTION_ID"), codes::toString);
    }

    @Test
    void connectionFieldsNameTheirProvider() {
        assertEquals("GMAIL", NodeCatalog.schema("email.send").properties().get("connectionId").connectionProvider());
        assertEquals("GOOGLE_SHEETS",
                NodeCatalog.schema("google.sheets").properties().get("connectionId").connectionProvider());
        assertEquals("HTTP", NodeCatalog.schema("http.request").properties().get("connectionId").connectionProvider());
        assertEquals("GMAIL",
                NodeCatalog.schema("trigger.gmail").properties().get("connectionId").connectionProvider());
        assertEquals("TELEGRAM",
                NodeCatalog.schema("trigger.telegram").properties().get("connectionId").connectionProvider());
        assertEquals("TELEGRAM",
                NodeCatalog.schema("telegram.send_message").properties().get("connectionId").connectionProvider());
        assertEquals("GOOGLE_CALENDAR",
                NodeCatalog.schema("google.calendar").properties().get("connectionId").connectionProvider());
        assertEquals("GOOGLE_DRIVE",
                NodeCatalog.schema("google.drive").properties().get("connectionId").connectionProvider());
        for (String type : TYPES) {
            NodeCatalog.schema(type).properties().forEach((name, field) -> {
                if (field.connectionProvider() != null) {
                    assertEquals("connectionId", name);
                    assertFalse(field.template(), "connectionId never accepts mappings");
                }
            });
        }
    }

    @Test
    void gmailTriggerQueryAndIntervalAreLiteralAndBounded() {
        assertFalse(field("trigger.gmail", "query").template() || field("trigger.gmail", "pollIntervalMinutes").template());
        assertFalse(NodeCatalog.schema("trigger.gmail").sideEffect());
        Field interval = field("trigger.gmail", "pollIntervalMinutes");
        assertTrue(interval.matchesShape(5) && interval.matchesShape(1440));
        assertFalse(interval.matchesShape(1.5d) || interval.matchesShape("5"));
        WorkflowDefinition ok = gmailDefinition(Map.of("connectionId", UUID.randomUUID().toString(),
                "query", "is:unread", "pollIntervalMinutes", 5));
        assertEquals(List.of(), new DefinitionValidator().validatePublish(ok).stream().map(ValidationIssue::code).toList());
        for (Map<String, Object> bad : List.of(
                Map.<String, Object>of("connectionId", UUID.randomUUID().toString(), "pollIntervalMinutes", 0),
                Map.<String, Object>of("connectionId", UUID.randomUUID().toString(), "pollIntervalMinutes", 1441),
                Map.<String, Object>of("connectionId", UUID.randomUUID().toString(), "query", "x".repeat(501)),
                Map.<String, Object>of("connectionId", " "),
                Map.<String, Object>of("query", "is:unread"))) {
            assertFalse(new DefinitionValidator().validatePublish(gmailDefinition(bad)).isEmpty(), bad.toString());
        }
    }

    private static WorkflowDefinition gmailDefinition(Map<String, Object> config) {
        return new WorkflowDefinition("1.0",
                List.of(new WorkflowDefinition.Node("manual", "trigger.manual", Map.of()),
                        new WorkflowDefinition.Node("mail", "trigger.gmail", config)),
                List.of(), Map.of());
    }

    @Test
    void coreLogicNodesAreSideEffectFreeLogicNodes() {
        for (String type : List.of("logic.switch", "data.set")) {
            assertEquals("logic", NodeCatalog.schema(type).category(), type);
            assertFalse(NodeCatalog.schema(type).sideEffect(), type);
            assertFalse(NodeSideEffects.isSideEffecting(type, Map.of()), type);
        }
        assertEquals("array", field("logic.switch", "cases").type());
        assertFalse(field("logic.switch", "cases").template());
        assertTrue(field("logic.switch", "value").template());
        assertEquals("object", field("data.set", "fields").type());
        assertTrue(field("data.set", "fields").template());
    }

    @Test
    void stringOnlyFieldsAreTemplateFieldsOfPlainStringType() {
        assertEquals(Set.of("subject", "body", "senderName", "replyToMessageId"),
                NodeCatalog.schema("email.send").stringOnlyFields());
        assertEquals(Set.of("text", "parseMode"), NodeCatalog.schema("telegram.send_message").stringOnlyFields());
        assertEquals(Set.of(), NodeCatalog.schema("logic.switch").stringOnlyFields());
        assertEquals(Set.of(), NodeCatalog.schema("data.set").stringOnlyFields());
        assertEquals(Set.of("method", "url"), NodeCatalog.schema("http.request").stringOnlyFields());
    }

    @Test
    void scalarTextHasNoDecimalPointOrExponentForIntegralNumbers() {
        assertEquals("12", com.weav.workflow.domain.definition.JsonValues.scalarText(12.0));
        assertEquals("12", com.weav.workflow.domain.definition.JsonValues.scalarText(new BigDecimal("12.000")));
        assertEquals("100000000000000000000", com.weav.workflow.domain.definition.JsonValues.scalarText(1e20));
        assertEquals("0", com.weav.workflow.domain.definition.JsonValues.scalarText(new BigDecimal("0.00")));
        assertEquals("2.5", com.weav.workflow.domain.definition.JsonValues.scalarText(2.5));
        assertEquals("-1001234567890", com.weav.workflow.domain.definition.JsonValues.scalarText(-1001234567890L));
        assertEquals("true", com.weav.workflow.domain.definition.JsonValues.scalarText(true));
        assertEquals("a", com.weav.workflow.domain.definition.JsonValues.scalarText("a"));
        assertEquals(null, com.weav.workflow.domain.definition.JsonValues.scalarText(null));
        assertEquals(null, com.weav.workflow.domain.definition.JsonValues.scalarText(Map.of()));
        assertEquals(null, com.weav.workflow.domain.definition.JsonValues.scalarText(List.of()));
        assertEquals(null, com.weav.workflow.domain.definition.JsonValues.scalarText(Double.NaN));
    }

    @Test
    void sideEffectFlagMatchesNodeSideEffects() {
        for (String type : TYPES) {
            assertEquals(NodeSideEffects.isSideEffecting(type, Map.of()), NodeCatalog.schema(type).sideEffect(), type);
        }
    }

    @Test
    void googleNodesDeclareTheirSideEffects() {
        assertTrue(NodeSideEffects.isSideEffecting("google.calendar", Map.of()));
        assertTrue(NodeSideEffects.isSideEffecting("google.drive", Map.of("operation", "upload")));
        assertTrue(NodeSideEffects.isSideEffecting("google.drive", Map.of("operation", "{{ trigger.op }}")));
        assertFalse(NodeSideEffects.isSideEffecting("google.drive", Map.of("operation", "list")));
        assertFalse(NodeSideEffects.isSideEffecting("google.drive", Map.of("operation", "download")));
        assertEquals(Set.of("upload", "list", "download"), field("google.drive", "operation").enumValues());
        assertFalse(field("google.drive", "operation").template());
        assertEquals("boolean", field("google.calendar", "sendInvitations").type());
        assertEquals(0, BigDecimal.ONE.compareTo(field("google.drive", "pageSize").minimum()));
    }

    @Test
    void sheetsLookupAndCalendarListAreReadOnlyEverythingElseStillWrites() {
        assertFalse(NodeSideEffects.isSideEffecting("google.sheets", Map.of("operation", "read")));
        assertFalse(NodeSideEffects.isSideEffecting("google.sheets", Map.of("operation", "lookup")));
        assertTrue(NodeSideEffects.isSideEffecting("google.sheets", Map.of("operation", "append")));
        assertTrue(NodeSideEffects.isSideEffecting("google.sheets", Map.of("operation", "{{ trigger.op }}")));
        assertFalse(NodeSideEffects.isSideEffecting("google.calendar", Map.of("operation", "list")));
        assertTrue(NodeSideEffects.isSideEffecting("google.calendar", Map.of("operation", "create")));
        assertTrue(NodeSideEffects.isSideEffecting("google.calendar", Map.of("operation", "{{ trigger.op }}")));
        assertTrue(NodeSideEffects.isSideEffecting("google.calendar", Map.of()));
    }

    @Test
    void polishedNodeFieldsKeepOldFieldsAndBoundTheNewOnes() {
        assertEquals(Set.of("read", "append", "update", "lookup"), field("google.sheets", "operation").enumValues());
        assertEquals(Set.of("RAW", "USER_ENTERED"), field("google.sheets", "valueInputOption").enumValues());
        Field limit = field("google.sheets", "limit");
        assertTrue(limit.matchesShape(1) && limit.matchesShape(100) && limit.matchesShape("{{ trigger.n }}"));
        assertFalse(limit.matchesShape(0) || limit.matchesShape(101) || limit.matchesShape(1.5d));
        Field maxResults = field("google.calendar", "maxResults");
        assertTrue(maxResults.matchesShape(50) && !maxResults.matchesShape(51) && !maxResults.matchesShape(0));
        assertEquals(Set.of("create", "list"), field("google.calendar", "operation").enumValues());
        assertEquals(Set.of("none", "HTML", "MarkdownV2"), field("telegram.send_message", "parseMode").enumValues());
        assertTrue(field("telegram.send_message", "disableNotification").matchesShape(true));
        assertTrue(field("telegram.send_message", "disableNotification").matchesShape("true"));
        Field reply = field("telegram.send_message", "replyToMessageId");
        assertTrue(reply.matchesShape(1) && !reply.matchesShape(0) && !reply.matchesShape(-5));
        assertEquals(Set.of("and", "or"), field("logic.condition", "combinator").enumValues());
        assertEquals("array", field("logic.condition", "conditions").type());
    }

    @Test
    void loaderRejectsUnsupportedKeywords() throws Exception {
        String valid = """
                {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"weav:node/x.y","title":"X",
                 "description":"d","x-weav-node":{"type":"x.y","category":"action","label":"X","sideEffect":false},
                 "type":"object","properties":{"a":{"type":"string","minLength":1}},"required":["a"],
                 "additionalProperties":false}""";
        NodeConfigSchema parsed = ClasspathNodeSchemaSource.parse("x.y.json", MAPPER.readTree(valid));
        assertEquals(List.of("a"), parsed.required());

        String rootKeyword = valid.replace("\"required\"", "\"patternProperties\":{},\"required\"");
        String fieldKeyword = valid.replace("\"minLength\":1", "\"pattern\":\"x\"");
        String wrongName = valid.replace("weav:node/x.y", "weav:node/other");
        for (String broken : List.of(rootKeyword, fieldKeyword, wrongName)) {
            JsonNode node = MAPPER.readTree(broken);
            assertThrows(IllegalArgumentException.class, () -> ClasspathNodeSchemaSource.parse("x.y.json", node));
        }
    }

    @Test
    void contractSchemaAgreesWithNodeFiles() throws Exception {
        Path path = Path.of("..", "..", "packages", "contracts", "http", "workflow", "definition.schema.json");
        JsonNode contract = MAPPER.readTree(Files.readString(path));
        Set<String> contractTypes = new LinkedHashSet<>();
        contract.at("/$defs/node/properties/type/enum").forEach(type -> contractTypes.add(type.stringValue()));
        assertEquals(NodeCatalog.supportedTypes(), contractTypes);

        Set<String> compared = new LinkedHashSet<>();
        for (JsonNode rule : contract.at("/$defs/node/allOf")) {
            List<String> types = new ArrayList<>();
            JsonNode single = rule.at("/if/properties/type/const");
            if (single.isString()) {
                types.add(single.stringValue());
            } else {
                rule.at("/if/properties/type/enum").forEach(type -> types.add(type.stringValue()));
            }
            for (String type : types) {
                compared.add(type);
                JsonNode config = rule.at("/then/properties/config");
                Map<String, Field> fields = NodeCatalog.schema(type).properties();
                if (config.at("/properties").isMissingNode()) {
                    assertTrue(fields.isEmpty(), type);
                    continue;
                }
                Set<String> contractFields = new LinkedHashSet<>();
                for (Map.Entry<String, JsonNode> property : config.at("/properties").properties()) {
                    contractFields.add(property.getKey());
                    assertFieldMatches(type + "." + property.getKey(), property.getValue(),
                            fields.get(property.getKey()));
                }
                assertEquals(contractFields, fields.keySet(), type);
            }
        }
        assertEquals(NodeCatalog.supportedTypes(), compared);
    }

    private static void assertFieldMatches(String where, JsonNode contract, Field field) {
        assertNotNull(field, where);
        if (contract.has("$ref")) {
            assertEquals("string", field.type(), where);
            return;
        }
        assertEquals(contract.has("type") ? contract.get("type").stringValue() : null, field.type(), where);
        Set<String> contractEnum = new LinkedHashSet<>();
        contract.path("enum").forEach(value -> contractEnum.add(value.stringValue()));
        assertEquals(contractEnum, field.enumValues(), where);
        if (contract.has("minimum")) {
            assertEquals(0, contract.get("minimum").decimalValue().compareTo(field.minimum()), where);
        }
        if (contract.has("items")) {
            assertEquals(contract.at("/items/type").stringValue(), field.items().type(), where);
        }
        if (contract.has("additionalProperties") && contract.get("additionalProperties").isObject()) {
            assertEquals(contract.at("/additionalProperties/type").stringValue(),
                    field.additionalProperties().type(), where);
        }
        assertEquals(contract.path("oneOf").size(), field.oneOf().size(), where);
        for (int i = 0; i < field.oneOf().size(); i++) {
            assertEquals(contract.at("/oneOf/" + i + "/type").stringValue(), field.oneOf().get(i).type(), where);
        }
    }
}
