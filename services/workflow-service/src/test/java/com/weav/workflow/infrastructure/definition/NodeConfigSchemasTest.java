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
            "ai.classify", "ai.summarize", "ocr.extract");

    /** The publish-required fields the validator hard-coded before schemas drove it. */
    private static final Map<String, List<String>> REQUIRED = Map.of(
            "trigger.schedule", List.of("cron", "timezone"),
            "http.request", List.of("method", "url"),
            "email.send", List.of("connectionId", "to", "subject", "body"),
            "google.sheets", List.of("connectionId", "operation", "spreadsheetId", "range"),
            "trigger.telegram", List.of("connectionId"),
            "telegram.send_message", List.of("connectionId", "chatId", "text"),
            "logic.condition", List.of("left", "operator", "right"),
            "ai.extract", List.of("text"),
            "ai.classify", List.of("content"),
            "ai.summarize", List.of("inputText"));

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
            "ocr.extract.artifactId", "ocr.extract.fileUrl");

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
        assertEquals("TELEGRAM",
                NodeCatalog.schema("trigger.telegram").properties().get("connectionId").connectionProvider());
        assertEquals("TELEGRAM",
                NodeCatalog.schema("telegram.send_message").properties().get("connectionId").connectionProvider());
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
    void sideEffectFlagMatchesNodeSideEffects() {
        for (String type : TYPES) {
            assertEquals(NodeSideEffects.isSideEffecting(type, Map.of()), NodeCatalog.schema(type).sideEffect(), type);
        }
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
