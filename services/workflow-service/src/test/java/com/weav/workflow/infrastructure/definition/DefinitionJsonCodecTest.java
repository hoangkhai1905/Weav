package com.weav.workflow.infrastructure.definition;

import com.weav.workflow.domain.definition.NodeCatalog;
import com.weav.workflow.domain.definition.DefinitionValidator;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DefinitionJsonCodecTest {
    private final ObjectMapper objectMapper = JsonMapper.builder().build();
    private final DefinitionJsonCodec codec = new DefinitionJsonCodec(objectMapper);

    @Test
    void decodesAndEncodesDefinitionsWithoutLosingNestedNullsOrImmutability() throws Exception {
        JsonNode source = objectMapper.readTree("""
                {
                  "schemaVersion": "1.0",
                  "nodes": [{
                    "id": "request",
                    "type": "http.request",
                    "config": {"method": "POST", "body": {"nested": {"value": null}, "values": [null]}}
                  }],
                  "edges": [{"id": "edge-1", "source": "request", "target": "next"}],
                  "variables": {"explicitNull": null, "count": 3}
                }
                """);

        WorkflowDefinition definition = codec.decode(source);
        ObjectNode sourceNode = (ObjectNode) source.path("nodes").get(0).path("config");
        sourceNode.put("method", "DELETE");
        Map<?, ?> config = definition.nodes().get(0).config();
        Map<?, ?> body = (Map<?, ?>) config.get("body");
        Map<?, ?> nested = (Map<?, ?>) body.get("nested");
        List<?> values = (List<?>) body.get("values");

        assertEquals("POST", config.get("method"));
        assertTrue(nested.containsKey("value"));
        assertNull(nested.get("value"));
        assertNull(values.get(0));
        assertNull(definition.variables().get("explicitNull"));
        assertThrows(UnsupportedOperationException.class, config::clear);
        assertThrows(UnsupportedOperationException.class, nested::clear);
        JsonNode encoded = codec.encode(definition);
        assertTrue(encoded.path("variables").has("explicitNull"));
        assertTrue(encoded.path("variables").path("explicitNull").isNull());
        assertTrue(encoded.path("nodes").get(0).path("config").path("body").path("nested").path("value").isNull());
        assertEquals(definition, codec.decode(encoded));
    }

    @Test
    void rejectsMalformedEnvelopeAndNonObjectNodeConfiguration() throws Exception {
        JsonNode missingNodes = objectMapper.readTree("{\"schemaVersion\":\"1.0\",\"edges\":[]}");
        JsonNode nullConfiguration = objectMapper.readTree("""
                {"schemaVersion":"1.0","nodes":[{"id":"m","type":"trigger.manual","config":null}],"edges":[]}
                """);
        JsonNode extraEnvelopeField = objectMapper.readTree("""
                {"schemaVersion":"1.0","nodes":[],"edges":[],"unexpected":true}
                """);
        JsonNode extraNodeField = objectMapper.readTree("""
                {"schemaVersion":"1.0","nodes":[{"id":"m","type":"trigger.manual","config":{},"unexpected":true}],"edges":[]}
                """);

        assertThrows(IllegalArgumentException.class, () -> codec.decode(missingNodes));
        assertThrows(IllegalArgumentException.class, () -> codec.decode(nullConfiguration));
        assertThrows(IllegalArgumentException.class, () -> codec.decode(extraEnvelopeField));
        assertThrows(IllegalArgumentException.class, () -> codec.decode(extraNodeField));
    }

    @Test
    void checksDocumentDepthAndSizeBeforeDecodingNestedValues() {
        Object deep = "leaf";
        for (int i = 0; i < 31; i++) {
            deep = Map.of("child", deep);
        }
        Map<String, Object> deepDocument = envelope(Map.of("deep", deep));
        Map<String, Object> largeDocument = envelope(Map.of(
                "large", "x".repeat(1_048_577)));

        assertThrows(IllegalArgumentException.class, () -> codec.decode(objectMapper.valueToTree(deepDocument)));
        assertThrows(IllegalArgumentException.class, () -> codec.decode(objectMapper.valueToTree(largeDocument)));
    }

    @Test
    void acceptsSerializedDocumentAtTheOneMiBByteLimit() throws Exception {
        JsonNode emptyPadding = objectMapper.valueToTree(envelope(Map.of("padding", "")));
        int emptyPaddingBytes = objectMapper.writeValueAsBytes(emptyPadding).length;
        JsonNode atLimit = objectMapper.valueToTree(envelope(Map.of(
                "padding", "x".repeat(DefinitionValidator.MAX_DEFINITION_BYTES - emptyPaddingBytes))));

        assertEquals(DefinitionValidator.MAX_DEFINITION_BYTES, objectMapper.writeValueAsBytes(atLimit).length);
        assertEquals(DefinitionValidator.MAX_DEFINITION_BYTES - emptyPaddingBytes,
                ((String) codec.decode(atLimit).variables().get("padding")).length());
    }

    @Test
    void schemaListsTheSameCatalogAndDraftBoundsAsTheJavaValidator() throws Exception {
        Path schemaPath = Path.of("..", "..", "packages", "contracts", "http", "workflow", "definition.schema.json");
        assertTrue(Files.exists(schemaPath), "Definition schema must be present at " + schemaPath.toAbsolutePath());
        JsonNode schema = objectMapper.readTree(Files.readString(schemaPath));
        JsonNode typeEnum = schema.at("/$defs/node/properties/type/enum");
        var types = new java.util.LinkedHashSet<String>();
        typeEnum.forEach(type -> types.add(type.stringValue()));

        assertEquals(NodeCatalog.supportedTypes(), types);
        assertFalse(types.contains("agent.task"));
        assertFalse(types.contains("google.docs"));
        assertEquals(200, schema.at("/properties/nodes/maxItems").intValue());
        assertEquals(1000, schema.at("/properties/edges/maxItems").intValue());
        assertEquals(3, schema.at("/$defs/node/required").size());
        assertEquals("\\S", schema.at("/$defs/node/properties/id/pattern").stringValue());
        assertEquals("\\S", schema.at("/$defs/edge/properties/id/pattern").stringValue());
        assertEquals("\\S", schema.at("/$defs/edge/properties/source/pattern").stringValue());
        assertEquals("\\S", schema.at("/$defs/edge/properties/target/pattern").stringValue());
        Set<String> configuredTypes = new java.util.LinkedHashSet<>();
        for (JsonNode rule : schema.at("/$defs/node/allOf")) {
            JsonNode type = rule.at("/if/properties/type/const");
            if (type.isString()) {
                assertSchemaConfigMatchesCatalog(rule, type.stringValue(), configuredTypes);
                continue;
            }
            for (JsonNode groupedType : rule.at("/if/properties/type/enum")) {
                assertSchemaConfigMatchesCatalog(rule, groupedType.stringValue(), configuredTypes);
            }
        }
        assertEquals(NodeCatalog.supportedTypes(), configuredTypes);
        assertEquals("#/$defs/connectionId",
                schema.at("/$defs/node/allOf/3/then/properties/config/properties/connectionId/$ref").stringValue());
        assertEquals("#/$defs/connectionId",
                schema.at("/$defs/node/allOf/5/then/properties/config/properties/connectionId/$ref").stringValue());
        assertEquals("uuid", schema.at("/$defs/connectionId/format").stringValue());
        assertTrue(schema.at("/$defs/connectionId/pattern").stringValue().contains("{12}"));
        assertEquals("https://json-schema.org/draft/2020-12/schema", schema.path("$schema").stringValue());
    }

    private static void assertSchemaConfigMatchesCatalog(JsonNode rule, String type, Set<String> configuredTypes) {
        configuredTypes.add(type);
        JsonNode config = rule.at("/then/properties/config");
        assertTrue(config.at("/required").isMissingNode(),
                "Draft schema must not require publish-complete fields for " + type);
        Set<String> schemaFields = new java.util.LinkedHashSet<>();
        config.at("/properties").properties().forEach(property -> schemaFields.add(property.getKey()));
        assertEquals(NodeCatalog.configFields(type), schemaFields,
                "Schema fields must match the Java catalog for " + type);
    }

    private static Map<String, Object> envelope(Map<String, Object> variables) {
        var document = new LinkedHashMap<String, Object>();
        document.put("schemaVersion", "1.0");
        document.put("nodes", List.of());
        document.put("edges", List.of());
        document.put("variables", variables);
        return document;
    }
}
