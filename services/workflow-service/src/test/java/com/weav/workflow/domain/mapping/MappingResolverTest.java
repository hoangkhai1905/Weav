package com.weav.workflow.domain.mapping;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

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
            "{{ trigger.input.items[0] }}",
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

    private static void assertMappingError(org.junit.jupiter.api.function.Executable action) {
        MappingException error = assertThrows(MappingException.class, action);
        assertEquals("MAPPING_ERROR", error.code());
        assertFalse(error.retryable());
    }
}
