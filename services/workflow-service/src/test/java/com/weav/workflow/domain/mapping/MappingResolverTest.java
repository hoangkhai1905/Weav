package com.weav.workflow.domain.mapping;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MappingResolverTest {
    private final MappingResolver resolver = new MappingResolver();

    @Test
    void preservesTheJsonTypeOfWholeExpressionsAndDistinguishesNullFromMissing() {
        Map<String, Object> triggerInput = new LinkedHashMap<>();
        triggerInput.put("count", 3);
        triggerInput.put("ready", true);
        triggerInput.put("explicitNull", null);
        triggerInput.put("profile", Map.of("email", "person@example.test"));
        var variables = new LinkedHashMap<String, Object>();
        variables.put("nullable", null);
        MappingContext context = new MappingContext(triggerInput, Map.of(), variables);

        assertEquals(3, resolver.resolve("{{ trigger.input.count }}", context));
        assertEquals(true, resolver.resolve("{{ trigger.input.ready }}", context));
        assertNull(resolver.resolve("{{ trigger.input.explicitNull }}", context));
        assertNull(resolver.resolve("{{ variables.nullable }}", context));
        assertEquals(Map.of("email", "person@example.test"),
                resolver.resolve("{{ trigger.input.profile }}", context));
        assertMappingError(() -> resolver.resolve("{{ trigger.input.missing }}", context));
        assertMappingError(() -> resolver.resolve("{{ trigger.input.count.value }}", context));
    }

    @Test
    void interpolatesOnlyScalarValuesAndUsesJsonNullText() {
        Map<String, Object> triggerInput = new LinkedHashMap<>();
        triggerInput.put("count", 3);
        triggerInput.put("ready", false);
        triggerInput.put("empty", null);
        triggerInput.put("profile", Map.of("email", "person@example.test"));
        MappingContext context = new MappingContext(triggerInput, Map.of(), Map.of());

        assertEquals("count=3; ready=false; empty=null", resolver.resolve(
                "count={{ trigger.input.count }}; ready={{ trigger.input.ready }}; empty={{ trigger.input.empty }}",
                context));
        assertMappingError(() -> resolver.resolve("profile={{ trigger.input.profile }}", context));
    }

    @Test
    void resolvesMappingsRecursivelyWithoutChangingTheInputTree() {
        Map<String, Object> source = new LinkedHashMap<>();
        source.put("label", "Hello {{ trigger.input.name }}");
        source.put("items", new ArrayList<>(List.of("{{ nodes.http1.output.body.message }}")));
        source.put("explicitNull", null);
        MappingContext context = new MappingContext(
                Map.of("name", "Ari"),
                Map.of("http1", Map.of("body", Map.of("message", "ready"))),
                Map.of("region", "west"));

        Object resolved = resolver.resolve(source, context, "send-email", "config.body");

        var expected = new LinkedHashMap<String, Object>();
        expected.put("label", "Hello Ari");
        expected.put("items", List.of("ready"));
        expected.put("explicitNull", null);
        assertEquals(expected, resolved);
        assertEquals("Hello {{ trigger.input.name }}", source.get("label"));
        assertEquals(List.of("{{ nodes.http1.output.body.message }}"), source.get("items"));
        Map<?, ?> resolvedMap = (Map<?, ?>) resolved;
        assertThrows(UnsupportedOperationException.class, resolvedMap::clear);
        assertNull(resolvedMap.get("explicitNull"));
    }

    @Test
    void rejectsOutputsMissingFromTheSuccessfulActivePathContext() {
        MappingContext context = new MappingContext(Map.of(), Map.of(), Map.of());

        assertMappingError(() -> resolver.resolve("{{ nodes.unknown.output.value }}", context,
                "consumer", "config.text"));
        assertMappingError(() -> resolver.resolve("{{ nodes.inactive-branch.output.value }}", context,
                "consumer", "config.text"));
    }

    @Test
    void resolvesDottedNodeIdsFromAvailableOutputKeysAndRejectsAmbiguousCandidates() {
        MappingContext dottedIdContext = new MappingContext(Map.of(),
                Map.of("customer.profile", Map.of("data", Map.of("email", "person@example.test"))), Map.of());
        assertEquals("person@example.test", resolver.resolve(
                "{{ nodes.customer.profile.output.data.email }}", dottedIdContext));

        MappingContext ambiguousContext = new MappingContext(Map.of(), Map.of(
                "source", Map.of("output", Map.of("value", "first")),
                "source.output", Map.of("value", "second")), Map.of());
        assertMappingError(() -> resolver.resolve("{{ nodes.source.output.output.value }}", ambiguousContext));
    }

    @Test
    void reportsStableNonRetryableErrorsWithDestinationContextAndNoExpressionText() {
        String rejectedExpression = "{{ variables.private_token + 'do-not-echo' }}";
        MappingException error = assertThrows(MappingException.class,
                () -> resolver.resolve(rejectedExpression, new MappingContext(Map.of(), Map.of(), Map.of()),
                        "consumer", "config.body.message"));

        assertEquals("MAPPING_ERROR", error.code());
        assertEquals("consumer", error.nodeId());
        assertEquals("config.body.message", error.field());
        assertFalse(error.retryable());
        assertFalse(error.getMessage().contains("private_token"));
        assertFalse(error.getMessage().contains("do-not-echo"));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "{{ trigger.input.items[ }}",
            "{{ trigger.input.items[0]] }}",
            "{{ trigger.input.items[0][ }}",
            "{{ trigger.input.items[[0] }}",
            "{{ trigger.input.items] }}",
            "{{ trigger.input.items[] }}",
            "{{ trigger.input.items[-1] }}",
            "{{ trigger.input.items[01] }}",
            "{{ trigger.input.items[a] }}",
            "{{ trigger.input.items[0 }}",
            "{{ trigger.input.items[0]x }}",
            "{{ trigger.input.items[0].[1] }}",
            "{{ trigger.input.[0] }}",
            "{{ trigger.input.items[10000] }}",
            "{{ trigger.input.toString() }}",
            "{{ trigger.input.count + 1 }}",
            "{{ variables.region | upper }}",
            "{{ process.input.name }}",
            "{{ trigger.input.name",
            "trigger.input.name }}",
            "{{   }}"
    })
    void rejectsMalformedOrExecutableMappingSyntax(String expression) {
        MappingException error = assertThrows(MappingException.class,
                () -> resolver.resolve(expression, new MappingContext(Map.of(), Map.of(), Map.of())));

        assertEquals("MAPPING_ERROR", error.code());
        assertFalse(error.retryable());
        assertFalse(error.getMessage().contains(expression));
    }

    @Test
    void referencesFindsMappingsRecursivelyAndUsesDefinitionIdsToDisambiguateDots() {
        Object config = Map.of("body", List.of(
                "{{ nodes.api.v1.output.response.data }}",
                Map.of("fallback", "{{ variables.region }}")));

        assertEquals(Set.of("api.v1"), resolver.references(config, Set.of("api", "api.v1")));
        assertEquals(Set.of("api.v1"), resolver.references(config));
    }

    @Test
    void rejectsAnEmptyOutputPathSegmentForReferencesAndResolution() {
        String simpleId = "{{ nodes.source.output. }}";
        String dottedId = "{{ nodes.customer.profile.output. }}";

        assertMappingError(() -> resolver.references(simpleId));
        assertMappingError(() -> resolver.references(simpleId, Set.of("source")));
        assertMappingError(() -> resolver.references(dottedId));
        assertMappingError(() -> resolver.references(dottedId, Set.of("customer.profile")));

        MappingContext context = new MappingContext(Map.of(), Map.of(
                "source", Map.of("value", "available"),
                "customer.profile", Map.of("value", "available")), Map.of());
        assertMappingError(() -> resolver.resolve(simpleId, context));
        assertMappingError(() -> resolver.resolve(dottedId, context));
    }

    @Test
    void rejectsAmbiguousDottedIdentifiersWhenMultipleDefinitionIdsMatch() {
        assertMappingError(() -> resolver.references(
                "{{ nodes.source.output.output.value }}", Set.of("source", "source.output")));
    }

    private static MappingContext listContext() {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("attachments", List.of(
                Map.of("fileId", "f0", "size", 5), Map.of("fileId", "f1", "size", 6)));
        input.put("grid", List.of(List.of("a", "b"), List.of("c", "d")));
        input.put("map", Map.of("0", "zero"));
        input.put("items", List.of("x"));
        return new MappingContext(input, Map.of("rows", Map.of("rows", List.of(Map.of("values", List.of("v"))))), Map.of());
    }

    @Test
    void indexesListsWithDotAndBracketSyntaxKeepingTheNativeType() {
        MappingContext context = listContext();

        assertEquals(Map.of("fileId", "f0", "size", 5), resolver.resolve("{{ trigger.input.attachments[0] }}", context));
        assertEquals(Map.of("fileId", "f1", "size", 6), resolver.resolve("{{ trigger.input.attachments.1 }}", context));
        assertEquals("f1", resolver.resolve("{{ trigger.input.attachments[1].fileId }}", context));
        assertEquals("d", resolver.resolve("{{ trigger.input.grid[1][1] }}", context));
        assertEquals("c", resolver.resolve("{{ trigger.input.grid[1].0 }}", context));
        assertEquals("v", resolver.resolve("{{ nodes.rows.output.rows[0].values[0] }}", context));
        assertEquals("zero", resolver.resolve("{{ trigger.input.map.0 }}", context));
        assertEquals("zero", resolver.resolve("{{ trigger.input.map[0] }}", context));
        assertEquals("file f0 (5 bytes)",
                resolver.resolve("file {{ trigger.input.attachments[0].fileId }} ({{ trigger.input.attachments[0].size }} bytes)", context));
    }

    @Test
    void rejectsOutOfRangeAndLeadingZeroIndexesAtRunTime() {
        MappingContext context = listContext();

        assertMappingError(() -> resolver.resolve("{{ trigger.input.attachments[2] }}", context));
        assertMappingError(() -> resolver.resolve("{{ trigger.input.attachments.01 }}", context));
        assertMappingError(() -> resolver.resolve("{{ trigger.input.attachments.-1 }}", context));
        assertMappingError(() -> resolver.resolve("{{ trigger.input.attachments.x }}", context));
        assertMappingError(() -> resolver.resolve("{{ trigger.input.items[0].name }}", context));
    }

    @Test
    void referencesParsesBracketsAfterTheOutputMarker() {
        assertEquals(Set.of("rows"), resolver.references("{{ nodes.rows.output.rows[0].values[1] }}"));
        assertEquals(Set.of("a.b"), resolver.references("{{ nodes.a.b.output.rows[0] }}", Set.of("a.b")));
    }

    @Test
    void existingExpressionsResolveIdentically() {
        MappingContext context = new MappingContext(Map.of("a", Map.of("b", 1), "n", 2),
                Map.of("api.v1", Map.of("data", Map.of("x", "y"))), Map.of("v", "w"));

        assertEquals(1, resolver.resolve("{{ trigger.input.a.b }}", context));
        assertEquals("y", resolver.resolve("{{nodes.api.v1.output.data.x}}", context));
        assertEquals("w!", resolver.resolve("{{ variables.v }}!", context));
        assertEquals(Map.of("b", 1), resolver.resolve("{{ trigger.input.a }}", context));
        assertMappingError(() -> resolver.resolve("{{ trigger.input.n.b }}", context));
    }

    @Test
    void runExpressionsResolveFromTheRunAndKeepOldNamesWorking() {
        UUID runId = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
        UUID workflowId = UUID.fromString("00000000-0000-0000-0000-0000000000b2");
        RunInfo run = new RunInfo(runId, workflowId, "Hóa đơn", Instant.parse("2026-10-09T03:00:00Z"));
        MappingContext context = new MappingContext(Map.of(), Map.of("now", Map.of("x", "from node")),
                Map.of("now", "from variable"), run);

        assertEquals("Sent 2026-10-09T03:00:00Z", resolver.resolve("Sent {{ now }}", context));
        assertEquals(runId.toString(), resolver.resolve("{{ run.id }}", context));
        assertEquals(workflowId.toString(), resolver.resolve("{{ workflow.id }}", context));
        assertEquals("Hóa đơn #" + runId, resolver.resolve("{{ workflow.name }} #{{ run.id }}", context));
        // A node or a variable literally named "now" keeps resolving as before.
        assertEquals("from node", resolver.resolve("{{ nodes.now.output.x }}", context));
        assertEquals("from variable", resolver.resolve("{{ variables.now }}", context));
        assertEquals(Set.of("now"), resolver.references("{{ nodes.now.output.x }} {{ now }}", Set.of("now")));
    }

    @Test
    void runExpressionsAreUnavailableWithoutRunInfo() {
        MappingContext context = new MappingContext(Map.of(), Map.of(), Map.of());

        assertMappingError(() -> resolver.resolve("{{ now }}", context));
        assertMappingError(() -> resolver.resolve("{{ run.id }}", context));
        assertMappingError(() -> resolver.resolve("{{ workflow.name }}", context));
        MappingContext unnamed = new MappingContext(Map.of(), Map.of(), Map.of(),
                new RunInfo(UUID.randomUUID(), UUID.randomUUID(), null, Instant.EPOCH));
        assertMappingError(() -> resolver.resolve("{{ workflow.name }}", unnamed));
        assertMappingError(() -> resolver.resolve("{{ run.other }}", unnamed));
        assertMappingError(() -> resolver.resolve("{{ nowhere }}", unnamed));
    }

    private static void assertMappingError(org.junit.jupiter.api.function.Executable action) {
        MappingException error = assertThrows(MappingException.class, action);
        assertEquals("MAPPING_ERROR", error.code());
        assertFalse(error.retryable());
    }
}
