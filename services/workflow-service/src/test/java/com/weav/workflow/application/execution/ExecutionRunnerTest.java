package com.weav.workflow.application.execution;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.node.NodeExecutorRegistry;
import com.weav.workflow.application.port.out.ExecutionStatePort;
import com.weav.workflow.application.port.out.RetryWaitPort;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.execution.GraphState;
import com.weav.workflow.domain.model.aggregate.execution.NodeExecution;
import com.weav.workflow.domain.model.aggregate.execution.NodeExecutionAttempt;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowVersion;
import com.weav.workflow.domain.valueobject.AttemptStatus;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.NodeExecutionStatus;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ExecutionRunnerTest {

    @Test
    void persistsRunningAttemptsBeforeCallingReadyNodesAndRunsThemConcurrently() throws Exception {
        CountDownLatch entered = new CountDownLatch(2);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger active = new AtomicInteger();
        AtomicInteger maximum = new AtomicInteger();
        NodeExecutor action = executor("http.request", (context, config) -> {
            int now = active.incrementAndGet();
            maximum.accumulateAndGet(now, Math::max);
            entered.countDown();
            try {
                if (!release.await(5, TimeUnit.SECONDS)) {
                    throw new NodeExecutor.Failure("TIMEOUT", "The test gate timed out.", true);
                }
                return new NodeExecutor.Result(Map.of("node", context.nodeId()), null);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new NodeExecutor.Failure("WORKER_INTERRUPTED", "The test gate was interrupted.", true);
            } finally {
                active.decrementAndGet();
            }
        });
        WorkflowDefinition definition = definition(
                List.of(node("left", "http.request", Map.of()), node("right", "http.request", Map.of())),
                List.of(edge("root-left", "root", "left", null), edge("root-right", "root", "right", null)));

        try (Harness harness = harness(definition, Map.of(), List.of(action), 2,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            var run = harness.callers.submit(() -> harness.runner.run(harness.lease));
            assertTrue(entered.await(5, TimeUnit.SECONDS), "both ready nodes should be admitted concurrently");
            assertEquals(2, maximum.get());
            assertEquals(NodeExecutionStatus.RUNNING, harness.state.snapshot().nodes().get("left").getStatus());
            assertEquals(NodeExecutionStatus.RUNNING, harness.state.snapshot().nodes().get("right").getStatus());
            assertEquals(2, harness.state.snapshot().attempts().stream()
                    .filter(attempt -> attempt.getStatus() == AttemptStatus.RUNNING).count());

            release.countDown();
            run.get(5, TimeUnit.SECONDS);

            assertEquals(ExecutionStatus.SUCCESS, harness.state.snapshot().status(), harness.state::summary);
            assertEquals(NodeExecutionStatus.SUCCESS, harness.state.snapshot().nodes().get("left").getStatus());
            assertEquals(NodeExecutionStatus.SUCCESS, harness.state.snapshot().nodes().get("right").getStatus());
        }
    }

    @Test
    void preservesAttemptBudgetAndPersistedOneAndTwoSecondRetryEligibility() {
        Instant base = Instant.parse("2026-09-22T00:00:00Z");
        List<Instant> retryTimes = new ArrayList<>();
        AtomicInteger calls = new AtomicInteger();
        NodeExecutor action = executor("http.request", (context, config) -> {
            if (calls.incrementAndGet() < 3) {
                throw new NodeExecutor.Failure("NETWORK_ERROR", "temporary provider failure", true);
            }
            return new NodeExecutor.Result(Map.of("attempt", context.attemptNumber()), null);
        });
        WorkflowDefinition definition = definition(
                List.of(node("action", "http.request", Map.of())),
                List.of(edge("root-action", "root", "action", null)));
        AtomicReference<Instant> now = new AtomicReference<>(base);
        Clock clock = mutableClock(now);

        try (Harness harness = harness(definition, Map.of(), List.of(action), 1,
                eligibleAt -> {
                    retryTimes.add(eligibleAt);
                    now.set(eligibleAt);
                    return CompletableFuture.completedFuture(null);
                }, clock)) {
            harness.runner.run(harness.lease);

            assertEquals(ExecutionStatus.SUCCESS, harness.state.snapshot().status(), harness.state::summary);
            assertEquals(3, harness.state.snapshot().nodes().get("action").getAttemptCount());
            assertEquals(List.of(base.plusSeconds(1), base.plusSeconds(3)), retryTimes);
            assertEquals(List.of(AttemptStatus.FAILED, AttemptStatus.FAILED, AttemptStatus.SUCCESS),
                    harness.state.snapshot().attempts().stream().map(NodeExecutionAttempt::getStatus).toList());
            assertTrue(harness.state.snapshot().nextAttempts().isEmpty());
        }
    }

    @Test
    void exposesOnlySuccessfulActivePathOutputsToMappedNodesAndSkipsInactiveBranches() {
        AtomicReference<Map<String, Object>> resolvedConfig = new AtomicReference<>();
        AtomicInteger actionCalls = new AtomicInteger();
        NodeExecutor action = executor("http.request", (context, config) -> {
            actionCalls.incrementAndGet();
            resolvedConfig.set(config);
            return new NodeExecutor.Result(Map.of("seen", config.get("body")), null);
        });
        WorkflowDefinition definition = definition(
                List.of(
                        node("condition", "logic.condition", Map.of(
                                "left", "{{ trigger.input.allow }}", "operator", "eq", "right", true)),
                        node("selected", "http.request", Map.of("body", "{{ nodes.condition.output.value }}")),
                        node("inactive", "http.request", Map.of("body", "{{ nodes.condition.output.value }}"))),
                List.of(
                        edge("root-condition", "root", "condition", null),
                        edge("condition-selected", "condition", "selected", "true"),
                        edge("condition-inactive", "condition", "inactive", "false")));

        try (Harness harness = harness(definition, Map.of("allow", true), List.of(action), 2,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.runner.run(harness.lease);

            assertEquals(ExecutionStatus.SUCCESS, harness.state.snapshot().status(), harness.state::summary);
            assertEquals(1, actionCalls.get());
            assertEquals(Map.of("body", true), resolvedConfig.get());
            assertEquals(NodeExecutionStatus.SUCCESS, harness.state.snapshot().nodes().get("selected").getStatus());
            assertEquals(NodeExecutionStatus.SKIPPED, harness.state.snapshot().nodes().get("inactive").getStatus());
        }
    }

    private static Map<String, Object> multiCondition(Object operatorMapping) {
        Map<String, Object> first = new java.util.LinkedHashMap<>();
        first.put("left", "{{ trigger.input.a }}");
        first.put("operator", operatorMapping);
        first.put("right", 3);
        Map<String, Object> second = new java.util.LinkedHashMap<>();
        second.put("left", "x");
        second.put("operator", "eq");
        second.put("right", "x");
        return Map.of("combinator", "and", "conditions", List.of(first, second));
    }

    @Test
    void multiConditionWithMappedLeftAndOperatorResolvesAndSelectsThePort() {
        for (Map.Entry<Object, String> expected : Map.<Object, String>of(5, "true", 1, "false").entrySet()) {
            WorkflowDefinition definition = definition(
                    List.of(node("condition", "logic.condition", multiCondition("{{ trigger.input.op }}")),
                            node("yes", "http.request", Map.of()), node("no", "http.request", Map.of())),
                    List.of(edge("root-condition", "root", "condition", null),
                            edge("c-yes", "condition", "yes", "true"), edge("c-no", "condition", "no", "false")));
            try (Harness harness = harness(definition, Map.of("a", expected.getKey(), "op", "gt"),
                    List.of(executor("http.request", (context, config) -> new NodeExecutor.Result(Map.of(), null))), 1,
                    eligibleAt -> CompletableFuture.completedFuture(null))) {
                harness.runner.run(harness.lease);

                assertEquals(ExecutionStatus.SUCCESS, harness.state.snapshot().status(), harness.state::summary);
                assertEquals(Map.of("value", expected.getValue().equals("true")),
                        harness.state.snapshot().nodes().get("condition").getOutput());
                String chosen = expected.getValue().equals("true") ? "yes" : "no";
                String other = chosen.equals("yes") ? "no" : "yes";
                assertEquals(NodeExecutionStatus.SUCCESS, harness.state.snapshot().nodes().get(chosen).getStatus());
                assertEquals(NodeExecutionStatus.SKIPPED, harness.state.snapshot().nodes().get(other).getStatus());
            }
        }
    }

    @Test
    void aResolvedBadConditionOperatorIsAConfigurationErrorInBothForms() {
        Map<String, Object> single = Map.of("left", 1, "operator", "{{ trigger.input.op }}", "right", 1);
        for (Map<String, Object> config : List.of(single, multiCondition("{{ trigger.input.op }}"))) {
            WorkflowDefinition definition = definition(List.of(node("condition", "logic.condition", config)),
                    List.of(edge("root-condition", "root", "condition", null)));
            try (Harness harness = harness(definition, Map.of("a", 5, "op", "bad"), List.of(), 1,
                    eligibleAt -> CompletableFuture.completedFuture(null))) {
                harness.runner.run(harness.lease);

                assertEquals(ExecutionStatus.FAILED, harness.state.snapshot().status(), harness.state::summary);
                assertEquals("CONFIGURATION_ERROR",
                        harness.state.snapshot().nodes().get("condition").getError().get("code"));
            }
        }
    }

    @Test
    void numericTelegramChatIdMappedFromTriggerInputPassesConfigurationRevalidation() {
        AtomicReference<Map<String, Object>> resolvedConfig = new AtomicReference<>();
        NodeExecutor send = executor("telegram.send_message", (context, config) -> {
            resolvedConfig.set(config);
            return new NodeExecutor.Result(Map.of("sent", true), null);
        });
        WorkflowDefinition definition = definition(
                List.of(node("send", "telegram.send_message", Map.of(
                        "connectionId", UUID.randomUUID().toString(),
                        "chatId", "{{ trigger.input.message.chat.id }}",
                        "text", "Echo: {{ trigger.input.message.text }}"))),
                List.of(edge("root-send", "root", "send", null)));
        Map<String, Object> update = Map.of("message", Map.of(
                "chat", Map.of("id", -1001234567890L), "text", "hi"));

        try (Harness harness = harness(definition, update, List.of(send), 1,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.runner.run(harness.lease);

            assertEquals(ExecutionStatus.SUCCESS, harness.state.snapshot().status(), harness.state::summary);
            assertEquals(-1001234567890L, resolvedConfig.get().get("chatId"));
            assertEquals("Echo: hi", resolvedConfig.get().get("text"));
        }
    }

    @Test
    void failsClosedForMissingAdaptersAndStoresOnlySanitizedTerminalErrors() {
        WorkflowDefinition definition = definition(
                List.of(node("action", "http.request", Map.of())),
                List.of(edge("root-action", "root", "action", null)));

        try (Harness harness = harness(definition, Map.of(), List.of(), 1,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.runner.run(harness.lease);

            assertEquals(ExecutionStatus.FAILED, harness.state.snapshot().status(), harness.state::summary);
            assertEquals(NodeExecutionStatus.FAILED, harness.state.snapshot().nodes().get("action").getStatus());
            assertEquals(AttemptStatus.FAILED, harness.state.snapshot().attempts().getFirst().getStatus());
            Map<String, Object> error = harness.state.snapshot().nodes().get("action").getError();
            assertEquals("DEPENDENCY_NOT_CONFIGURED", error.get("code"));
            assertNotNull(error.get("message"));
            assertFalse(error.get("message").toString().contains("secret"));
        }
    }

    @Test
    void mappingConfigurationAndAuthenticationFailuresConsumeOneAttemptWithoutRetry() {
        WorkflowDefinition mappingDefinition = definition(
                List.of(node("action", "http.request", Map.of(
                        "method", "GET", "url", "https://example.test",
                        "body", "{{ nodes.root.output.missing }}"))),
                List.of(edge("root-action", "root", "action", null)));
        assertSingleNonRetryableFailure(mappingDefinition, executor("http.request",
                (context, config) -> new NodeExecutor.Result(Map.of("unexpected", true), null)),
                "MAPPING_ERROR", 0);

        WorkflowDefinition configurationDefinition = definition(
                List.of(node("action", "http.request", Map.of(
                        "headers", Map.of("x-test", 42)))),
                List.of(edge("root-action", "root", "action", null)));
        assertSingleNonRetryableFailure(configurationDefinition, executor("http.request",
                (context, config) -> new NodeExecutor.Result(Map.of("unexpected", true), null)),
                "CONFIGURATION_ERROR", 0);

        WorkflowDefinition authenticationDefinition = definition(
                List.of(node("action", "http.request", Map.of(
                        "method", "GET", "url", "https://example.test"))),
                List.of(edge("root-action", "root", "action", null)));
        assertSingleNonRetryableFailure(authenticationDefinition, executor("http.request",
                (context, config) -> {
                    throw new NodeExecutor.Failure("AUTHENTICATION_REJECTED",
                            "The provider rejected the configured credentials.", false);
                }), "AUTHENTICATION_REJECTED", 1);
    }

    @Test
    void aConfigurationFailureStoresTheFailingFieldInTheNodeError() {
        WorkflowDefinition definition = definition(
                List.of(node("action", "http.request", Map.of("method", "GET", "url", "https://example.test"))),
                List.of(edge("root-action", "root", "action", null)));
        NodeExecutor failing = executor("http.request", (context, config) -> {
            throw NodeExecutor.Failure.invalidField("to", "is not a valid email address.");
        });
        try (Harness harness = harness(definition, Map.of(), List.of(failing), 1,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.runner.run(harness.lease);

            Map<String, Object> error = harness.state.snapshot().nodes().get("action").getError();
            assertEquals("CONFIGURATION_ERROR", error.get("code"));
            assertEquals("The 'to' field is not a valid email address.", error.get("message"));
            assertEquals(Map.of("field", "to"), error.get("details"));
        }
    }

    @Test
    void aMissingMappedValueNamesTheFieldInTheMappingError() {
        WorkflowDefinition definition = definition(
                List.of(node("action", "http.request", Map.of(
                        "method", "GET", "url", "https://example.test",
                        "body", "{{ trigger.input.body.x }}"))),
                List.of(edge("root-action", "root", "action", null)));
        NodeExecutor never = executor("http.request",
                (context, config) -> new NodeExecutor.Result(Map.of("unexpected", true), null));
        try (Harness harness = harness(definition, Map.of(), List.of(never), 1,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.runner.run(harness.lease);

            Map<String, Object> error = harness.state.snapshot().nodes().get("action").getError();
            assertEquals("MAPPING_ERROR", error.get("code"));
            assertEquals("The 'body' field refers to a value that is missing.", error.get("message"));
            assertEquals(Map.of("field", "body"), error.get("details"));
        }
    }

    @Test
    void aMissingMappedRecipientNamesTheToFieldOfEmailSend() {
        WorkflowDefinition definition = definition(
                List.of(node("action", "email.send", Map.of(
                        "to", "{{ trigger.input.fromEmail }}", "subject", "Re", "body", "x"))),
                List.of(edge("root-action", "root", "action", null)));
        NodeExecutor never = executor("email.send",
                (context, config) -> new NodeExecutor.Result(Map.of("unexpected", true), null));
        try (Harness harness = harness(definition, Map.of("from", "x"), List.of(never), 1,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.runner.run(harness.lease);

            Map<String, Object> error = harness.state.snapshot().nodes().get("action").getError();
            assertEquals("The 'to' field refers to a value that is missing.", error.get("message"));
            assertEquals(Map.of("field", "to"), error.get("details"));
        }
    }

    @Test
    void switchRoutesToTheMatchingCaseAndSkipsTheOtherBranches() {
        AtomicReference<String> ran = new AtomicReference<>("");
        NodeExecutor action = executor("http.request", (context, config) -> {
            ran.updateAndGet(value -> value + context.nodeId() + ";");
            return new NodeExecutor.Result(Map.of("ok", true), null);
        });
        WorkflowDefinition definition = switchDefinition("{{ trigger.input.plan }}");

        // a mapped number matches the case written as text
        try (Harness harness = harness(definition, Map.of("plan", 2), List.of(action), 2,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.runner.run(harness.lease);

            assertEquals(ExecutionStatus.SUCCESS, harness.state.snapshot().status(), harness.state::summary);
            assertEquals("two;", ran.get());
            assertEquals(Map.of("value", 2, "port", "2"), harness.state.snapshot().nodes().get("switch").getOutput());
            assertEquals(NodeExecutionStatus.SUCCESS, harness.state.snapshot().nodes().get("two").getStatus());
            assertEquals(NodeExecutionStatus.SKIPPED, harness.state.snapshot().nodes().get("one").getStatus());
            assertEquals(NodeExecutionStatus.SKIPPED, harness.state.snapshot().nodes().get("other").getStatus());
        }
    }

    @Test
    void switchTakesTheDefaultPortWhenNothingMatches() {
        AtomicReference<String> ran = new AtomicReference<>("");
        NodeExecutor action = executor("http.request", (context, config) -> {
            ran.updateAndGet(value -> value + context.nodeId() + ";");
            return new NodeExecutor.Result(Map.of("ok", true), null);
        });

        for (Object plan : List.of("gold", 3, 2.5)) {
            ran.set("");
            try (Harness harness = harness(switchDefinition("{{ trigger.input.plan }}"), Map.of("plan", plan),
                    List.of(action), 2, eligibleAt -> CompletableFuture.completedFuture(null))) {
                harness.runner.run(harness.lease);

                assertEquals(ExecutionStatus.SUCCESS, harness.state.snapshot().status(), harness.state::summary);
                assertEquals("other;", ran.get(), String.valueOf(plan));
                assertEquals("default", harness.state.snapshot().nodes().get("switch").getOutput().get("port"));
            }
        }
    }

    @Test
    void dataSetOutputFeedsADownstreamMappingIncludingNestedValues() {
        AtomicReference<Map<String, Object>> seen = new AtomicReference<>();
        NodeExecutor action = executor("http.request", (context, config) -> {
            seen.set(config);
            return new NodeExecutor.Result(Map.of("ok", true), null);
        });
        WorkflowDefinition definition = definition(
                List.of(
                        node("shape", "data.set", Map.of("fields", Map.of(
                                "name", "{{ trigger.input.user.first }}",
                                "count", "{{ trigger.input.count }}",
                                "nested", Map.of("tags", List.of("{{ trigger.input.user.first }}", "fixed"))))),
                        node("send", "http.request", Map.of(
                                "body", "{{ nodes.shape.output.nested }}",
                                "headers", Map.of("n", "{{ nodes.shape.output.name }}")))),
                List.of(edge("root-shape", "root", "shape", null), edge("shape-send", "shape", "send", null)));

        try (Harness harness = harness(definition, Map.of("user", Map.of("first", "Ada"), "count", 7),
                List.of(action), 1, eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.runner.run(harness.lease);

            assertEquals(ExecutionStatus.SUCCESS, harness.state.snapshot().status(), harness.state::summary);
            assertEquals(Map.of("name", "Ada", "count", 7, "nested", Map.of("tags", List.of("Ada", "fixed"))),
                    harness.state.snapshot().nodes().get("shape").getOutput());
            assertEquals(Map.of("tags", List.of("Ada", "fixed")), seen.get().get("body"));
            assertEquals(Map.of("n", "Ada"), seen.get().get("headers"));
        }
    }

    @Test
    void mappedNumbersAndBooleansAreCoercedToTextForStringOnlyFields() {
        // 12.0 and 1e20 must not keep a decimal point or exponent; 2.5 keeps its fraction.
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("integer", 12);
        input.put("whole", 12.0);
        input.put("big", 1e20);
        input.put("decimal", 2.5);
        input.put("flag", true);
        input.put("off", false);
        for (Map.Entry<String, String> expected : Map.of("integer", "12", "whole", "12", "big",
                "100000000000000000000", "decimal", "2.5", "flag", "true", "off", "false").entrySet()) {
            AtomicReference<Map<String, Object>> resolved = new AtomicReference<>();
            NodeExecutor email = executor("email.send", (context, config) -> {
                resolved.set(config);
                return new NodeExecutor.Result(Map.of("sent", true), null);
            });
            WorkflowDefinition definition = definition(
                    List.of(node("mail", "email.send", Map.of(
                            "connectionId", UUID.randomUUID().toString(), "to", "a@example.test",
                            "subject", "{{ trigger.input." + expected.getKey() + " }}",
                            "body", "{{ trigger.input." + expected.getKey() + " }}"))),
                    List.of(edge("root-mail", "root", "mail", null)));

            try (Harness harness = harness(definition, input, List.of(email), 1,
                    eligibleAt -> CompletableFuture.completedFuture(null))) {
                harness.runner.run(harness.lease);

                assertEquals(ExecutionStatus.SUCCESS, harness.state.snapshot().status(),
                        expected.getKey() + " " + harness.state.summary());
                assertEquals(expected.getValue(), resolved.get().get("subject"), expected.getKey());
                assertEquals(expected.getValue(), resolved.get().get("body"), expected.getKey());
            }
        }
    }

    @Test
    void anObjectMappedIntoAStringFieldStillFailsWithConfigurationError() {
        WorkflowDefinition definition = definition(
                List.of(node("action", "email.send", Map.of(
                        "connectionId", UUID.randomUUID().toString(), "to", "a@example.test",
                        "subject", "{{ trigger.input.user }}", "body", "x"))),
                List.of(edge("root-action", "root", "action", null)));

        try (Harness harness = harness(definition, Map.of("user", Map.of("first", "Ada")),
                List.of(executor("email.send", (context, config) -> new NodeExecutor.Result(Map.of(), null))), 1,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.runner.run(harness.lease);

            assertEquals(ExecutionStatus.FAILED, harness.state.snapshot().status(), harness.state::summary);
            assertEquals("CONFIGURATION_ERROR",
                    harness.state.snapshot().nodes().get("action").getError().get("code"));
        }
    }

    @Test
    void twoSwitchPortsFeedingOneJoinStillRunTheJoin() {
        AtomicReference<String> ran = new AtomicReference<>("");
        NodeExecutor action = executor("http.request", (context, config) -> {
            ran.updateAndGet(value -> value + context.nodeId() + ";");
            return new NodeExecutor.Result(Map.of("ok", true), null);
        });
        WorkflowDefinition definition = definition(
                List.of(node("switch", "logic.switch", Map.of("value", "{{ trigger.input.plan }}",
                                "cases", List.of("a", "b"))),
                        node("join", "http.request", Map.of())),
                List.of(edge("root-switch", "root", "switch", null),
                        edge("switch-join-a", "switch", "join", "a"),
                        edge("switch-join-b", "switch", "join", "b")));

        try (Harness harness = harness(definition, Map.of("plan", "b"), List.of(action), 1,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.runner.run(harness.lease);

            assertEquals(ExecutionStatus.SUCCESS, harness.state.snapshot().status(), harness.state::summary);
            assertEquals("join;", ran.get());
        }
    }

    @Test
    void negativeAndNonIntegralNumbersAreCoercedToText() {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("negative", -5);
        input.put("negativeDecimal", -2.75);
        input.put("exact", new java.math.BigDecimal("0.10"));
        for (Map.Entry<String, String> expected : Map.of("negative", "-5", "negativeDecimal", "-2.75",
                "exact", "0.1").entrySet()) {
            AtomicReference<Map<String, Object>> resolved = new AtomicReference<>();
            NodeExecutor email = executor("email.send", (context, config) -> {
                resolved.set(config);
                return new NodeExecutor.Result(Map.of("sent", true), null);
            });
            WorkflowDefinition definition = definition(
                    List.of(node("mail", "email.send", Map.of(
                            "connectionId", UUID.randomUUID().toString(), "to", "a@example.test",
                            "subject", "{{ trigger.input." + expected.getKey() + " }}", "body", "x"))),
                    List.of(edge("root-mail", "root", "mail", null)));

            try (Harness harness = harness(definition, input, List.of(email), 1,
                    eligibleAt -> CompletableFuture.completedFuture(null))) {
                harness.runner.run(harness.lease);

                assertEquals(ExecutionStatus.SUCCESS, harness.state.snapshot().status(),
                        expected.getKey() + " " + harness.state.summary());
                assertEquals(expected.getValue(), resolved.get().get("subject"), expected.getKey());
            }
        }
    }

    @Test
    void dataSetFieldsMappedToAnEmptyOrNonObjectValueFailWithConfigurationError() {
        for (Object bad : List.of(Map.of(), 5, "text", List.of("a"))) {
            WorkflowDefinition definition = definition(
                    List.of(node("shape", "data.set", Map.of("fields", "{{ trigger.input.fields }}"))),
                    List.of(edge("root-shape", "root", "shape", null)));

            try (Harness harness = harness(definition, Map.of("fields", bad), List.of(), 1,
                    eligibleAt -> CompletableFuture.completedFuture(null))) {
                harness.runner.run(harness.lease);

                assertEquals(ExecutionStatus.FAILED, harness.state.snapshot().status(), harness.state::summary);
                assertEquals("CONFIGURATION_ERROR",
                        harness.state.snapshot().nodes().get("shape").getError().get("code"), String.valueOf(bad));
                assertEquals(1, harness.state.snapshot().nodes().get("shape").getAttemptCount());
            }
        }
    }

    private static WorkflowDefinition switchDefinition(String value) {
        return definition(
                List.of(
                        node("switch", "logic.switch", Map.of("value", value, "cases", List.of("1", "2"))),
                        node("one", "http.request", Map.of()),
                        node("two", "http.request", Map.of()),
                        node("other", "http.request", Map.of())),
                List.of(
                        edge("root-switch", "root", "switch", null),
                        edge("switch-one", "switch", "one", "1"),
                        edge("switch-two", "switch", "two", "2"),
                        edge("switch-other", "switch", "other", "default")));
    }

    private void assertSingleNonRetryableFailure(WorkflowDefinition definition, NodeExecutor executor,
                                                 String expectedCode, int expectedCalls) {
        AtomicInteger calls = new AtomicInteger();
        NodeExecutor countingExecutor = executor("http.request", (context, config) -> {
            calls.incrementAndGet();
            return executor.execute(context, config);
        });
        try (Harness harness = harness(definition, Map.of(), List.of(countingExecutor), 1,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.runner.run(harness.lease);

            assertEquals(ExecutionStatus.FAILED, harness.state.snapshot().status(), harness.state::summary);
            assertEquals(NodeExecutionStatus.FAILED, harness.state.snapshot().nodes().get("action").getStatus());
            assertEquals(1, harness.state.snapshot().nodes().get("action").getAttemptCount());
            assertEquals(List.of(AttemptStatus.FAILED), harness.state.snapshot().attempts().stream()
                    .map(NodeExecutionAttempt::getStatus).toList());
            assertEquals(expectedCode, harness.state.snapshot().nodes().get("action").getError().get("code"));
            assertTrue(harness.state.snapshot().nextAttempts().isEmpty());
            assertEquals(expectedCalls, calls.get());
        }
    }

    @Test
    void retriesTransientFailuresOnlyWhenARepeatCannotDuplicateAnExternalEffect() {
        NodeExecutor.Failure timeout = new NodeExecutor.Failure("HTTP_TIMEOUT", "timed out", true);
        NodeExecutor.Failure unavailable =
                new NodeExecutor.Failure("HTTP_DEPENDENCY_UNAVAILABLE", "down", true);
        NodeExecutor.Failure limitedBeforeEffect =
                new NodeExecutor.Failure("HTTP_RATE_LIMITED", "limited", true, true);
        NodeExecutor.Failure connect =
                new NodeExecutor.Failure("CONNECTION_UNAVAILABLE", "no connection", true, true);

        // Read-only nodes and keyed HTTP calls (even POST) retry; the code never needs an HTTP status number.
        assertEquals(2, callsUntilDone("http.request", Map.of("method", "GET", "url", "https://example.test"), timeout));
        assertEquals(2, callsUntilDone("http.request", Map.of("method", "POST", "url", "https://example.test"),
                new NodeExecutor.Failure("HTTP_RATE_LIMITED", "limited", true)));
        assertEquals(2, callsUntilDone("http.request", Map.of("method", "PUT", "url", "https://example.test"), unavailable));
        assertEquals(2, callsUntilDone("google.sheets", Map.of("operation", "read"), unavailable));
        // Side-effecting nodes without an idempotency key do not retry an ambiguous failure...
        assertEquals(1, callsUntilDone("email.send", Map.of(), unavailable));
        assertEquals(1, callsUntilDone("email.send", Map.of(), timeout));
        assertEquals(1, callsUntilDone("google.sheets", Map.of("operation", "append"), timeout));
        // ...but do when the failure provably happened before the effect.
        assertEquals(2, callsUntilDone("email.send", Map.of(), limitedBeforeEffect));
        assertEquals(2, callsUntilDone("google.sheets", Map.of("operation", "append"), connect));
    }

    /** Runs a single node that fails once with the failure and then succeeds; returns how often it was called. */
    private int callsUntilDone(String type, Map<String, Object> config, NodeExecutor.Failure firstFailure) {
        AtomicInteger calls = new AtomicInteger();
        NodeExecutor action = executor(type, (context, resolved) -> {
            if (calls.incrementAndGet() == 1) {
                throw firstFailure;
            }
            return new NodeExecutor.Result(Map.of("ok", true), null);
        });
        WorkflowDefinition definition = definition(List.of(node("action", type, config)),
                List.of(edge("root-action", "root", "action", null)));
        AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-09-22T00:00:00Z"));
        try (Harness harness = harness(definition, Map.of(), List.of(action), 1, eligibleAt -> {
            now.set(eligibleAt);
            return CompletableFuture.completedFuture(null);
        }, mutableClock(now))) {
            harness.runner.run(harness.lease);
            return calls.get();
        }
    }

    @Test
    void leaseLossCancelsInFlightNodeCallsInsteadOfLettingThemRunConcurrentlyWithTheNextOwner() throws Exception {
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch interrupted = new CountDownLatch(1);
        NodeExecutor action = executor("http.request", (context, config) -> {
            entered.countDown();
            try {
                Thread.sleep(30_000);
            } catch (InterruptedException exception) {
                interrupted.countDown();
                Thread.currentThread().interrupt();
            }
            return new NodeExecutor.Result(Map.of(), null);
        });
        WorkflowDefinition definition = definition(List.of(node("action", "http.request", Map.of())),
                List.of(edge("root-action", "root", "action", null)));
        try (Harness harness = harness(definition, Map.of(), List.of(action), 1,
                eligibleAt -> CompletableFuture.completedFuture(null),
                Clock.fixed(Instant.parse("2026-09-22T00:00:00Z"), ZoneOffset.UTC), Duration.ofMillis(50))) {
            var run = harness.callers.submit(() -> harness.runner.run(harness.lease));
            assertTrue(entered.await(5, TimeUnit.SECONDS));

            harness.state.leaseLive = false;

            assertTrue(interrupted.await(5, TimeUnit.SECONDS), "the in-flight node call should be cancelled");
            run.get(5, TimeUnit.SECONDS);
            assertEquals(NodeExecutionStatus.RUNNING, harness.state.snapshot().nodes().get("action").getStatus());
        }
    }

    @Test
    void anAlreadyFailedNodeFromRecoveryFailsTheRunWithItsErrorAndRunsNothing() {
        AtomicInteger calls = new AtomicInteger();
        NodeExecutor action = executor("email.send", (context, config) -> {
            calls.incrementAndGet();
            return new NodeExecutor.Result(Map.of(), null);
        });
        WorkflowDefinition definition = definition(List.of(node("action", "email.send", Map.of())),
                List.of(edge("root-action", "root", "action", null)));
        try (Harness harness = harness(definition, Map.of(), List.of(action), 1,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            // Mirrors ExecutionStateAdapter.recordInterruptedAttempts for a side-effecting node.
            harness.state.markFailedByRecovery("action", Map.of("code", "OUTCOME_UNKNOWN", "message", "unknown"));

            harness.runner.run(harness.lease);

            assertEquals(0, calls.get());
            assertEquals(ExecutionStatus.FAILED, harness.state.snapshot().status(), harness.state::summary);
            assertEquals("OUTCOME_UNKNOWN", harness.state.snapshot().nodes().get("action").getError().get("code"));
        }
    }

    @Test
    void cancelRequestedAfterTheFirstNodeStopsTheRunWithoutCallingTheNextNode() {
        AtomicBoolean cancel = new AtomicBoolean();
        AtomicInteger secondCalls = new AtomicInteger();
        NodeExecutor first = executor("http.request", (context, config) -> {
            if ("first".equals(context.nodeId())) {
                cancel.set(true);
            } else {
                secondCalls.incrementAndGet();
            }
            return new NodeExecutor.Result(Map.of("ok", true), null);
        });
        WorkflowDefinition definition = definition(
                List.of(node("first", "http.request", Map.of()), node("second", "http.request", Map.of())),
                List.of(edge("root-first", "root", "first", null), edge("first-second", "first", "second", null)));

        try (Harness harness = harness(definition, Map.of(), List.of(first), 1,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.state.cancelFlag = cancel;

            harness.runner.run(harness.lease);

            assertEquals(ExecutionStatus.CANCELLED, harness.state.snapshot().status(), harness.state::summary);
            assertEquals(NodeExecutionStatus.SUCCESS, harness.state.snapshot().nodes().get("first").getStatus());
            assertEquals(NodeExecutionStatus.CANCELLED, harness.state.snapshot().nodes().get("second").getStatus());
            assertEquals(0, secondCalls.get());
        }
    }

    @Test
    void cancelRequestedBeforeAnythingRunsCancelsEveryNode() {
        AtomicInteger calls = new AtomicInteger();
        NodeExecutor action = executor("http.request", (context, config) -> {
            calls.incrementAndGet();
            return new NodeExecutor.Result(Map.of(), null);
        });
        WorkflowDefinition definition = definition(List.of(node("action", "http.request", Map.of())),
                List.of(edge("root-action", "root", "action", null)));

        try (Harness harness = harness(definition, Map.of(), List.of(action), 1,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.state.cancelFlag.set(true);

            harness.runner.run(harness.lease);

            assertEquals(0, calls.get());
            assertEquals(ExecutionStatus.CANCELLED, harness.state.snapshot().status(), harness.state::summary);
            assertEquals(NodeExecutionStatus.CANCELLED, harness.state.snapshot().nodes().get("action").getStatus());
        }
    }

    @Test
    void aRecoveredRunThatAlreadyHasAStopRequestEndsCancelledOnItsFirstTurn() {
        AtomicInteger calls = new AtomicInteger();
        NodeExecutor action = executor("http.request", (context, config) -> {
            calls.incrementAndGet();
            return new NodeExecutor.Result(Map.of(), null);
        });
        WorkflowDefinition definition = definition(
                List.of(node("first", "http.request", Map.of()), node("second", "http.request", Map.of())),
                List.of(edge("root-first", "root", "first", null), edge("first-second", "first", "second", null)));

        try (Harness harness = harness(definition, Map.of(), List.of(action), 1,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.state.markRootDone();
            harness.state.cancelFlag.set(true);

            harness.runner.run(harness.lease);

            assertEquals(0, calls.get());
            assertEquals(ExecutionStatus.CANCELLED, harness.state.snapshot().status(), harness.state::summary);
            assertEquals(NodeExecutionStatus.SUCCESS, harness.state.snapshot().nodes().get("root").getStatus());
            assertEquals(NodeExecutionStatus.CANCELLED, harness.state.snapshot().nodes().get("first").getStatus());
            assertEquals(NodeExecutionStatus.CANCELLED, harness.state.snapshot().nodes().get("second").getStatus());
        }
    }

    @Test
    void stopRequestedWhileTheLastNodeRunsAndSucceedsEndsSuccess() {
        AtomicBoolean cancel = new AtomicBoolean();
        NodeExecutor last = executor("http.request", (context, config) -> {
            cancel.set(true);
            return new NodeExecutor.Result(Map.of("ok", true), null);
        });
        WorkflowDefinition definition = definition(List.of(node("only", "http.request", Map.of())),
                List.of(edge("root-only", "root", "only", null)));

        try (Harness harness = harness(definition, Map.of(), List.of(last), 1,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.state.cancelFlag = cancel;

            harness.runner.run(harness.lease);

            assertEquals(ExecutionStatus.SUCCESS, harness.state.snapshot().status(), harness.state::summary);
        }
    }

    @Test
    void stopRequestedDuringARetryWaitEndsCancelledWithoutRerunningTheNode() {
        Instant base = Instant.parse("2026-09-22T00:00:00Z");
        AtomicReference<Instant> now = new AtomicReference<>(base);
        AtomicBoolean cancel = new AtomicBoolean();
        AtomicInteger calls = new AtomicInteger();
        List<Instant> waits = new ArrayList<>();
        NodeExecutor flaky = executor("http.request", (context, config) -> {
            calls.incrementAndGet();
            throw new NodeExecutor.Failure("NETWORK_ERROR", "temporary provider failure", true);
        });
        WorkflowDefinition definition = definition(List.of(node("action", "http.request", Map.of())),
                List.of(edge("root-action", "root", "action", null)));

        try (Harness harness = harness(definition, Map.of(), List.of(flaky), 1, eligibleAt -> {
            waits.add(eligibleAt);
            now.set(eligibleAt);
            cancel.set(true); // the user presses Stop while the run is backing off
            return CompletableFuture.completedFuture(null);
        }, mutableClock(now))) {
            harness.state.cancelFlag = cancel;

            harness.runner.run(harness.lease);

            assertEquals(1, calls.get());
            assertEquals(1, waits.size());
            assertEquals(ExecutionStatus.CANCELLED, harness.state.snapshot().status(), harness.state::summary);
            assertEquals(NodeExecutionStatus.CANCELLED, harness.state.snapshot().nodes().get("action").getStatus());
        }
    }

    @Test
    void nowAndRunIdResolveFromTheRunAndTheInjectedClock() {
        AtomicReference<Map<String, Object>> resolved = new AtomicReference<>();
        NodeExecutor action = executor("http.request", (context, config) -> {
            resolved.set(config);
            return new NodeExecutor.Result(Map.of(), null);
        });
        WorkflowDefinition definition = definition(
                List.of(node("action", "http.request", Map.of("body", "{{ now }}|{{ run.id }}"))),
                List.of(edge("root-action", "root", "action", null)));

        try (Harness harness = harness(definition, Map.of(), List.of(action), 1,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.runner.run(harness.lease);

            assertEquals(ExecutionStatus.SUCCESS, harness.state.snapshot().status(), harness.state::summary);
            assertEquals("2026-09-22T00:00:00Z|" + harness.lease.executionId(), resolved.get().get("body"));
        }
    }

    private static NodeExecutor executor(String type, Invoker invoker) {
        return new NodeExecutor() {
            @Override
            public String type() {
                return type;
            }

            @Override
            public Result execute(Context context, Map<String, Object> resolvedConfig) {
                return invoker.invoke(context, resolvedConfig);
            }
        };
    }

    private static WorkflowDefinition definition(List<WorkflowDefinition.Node> nodes,
                                                 List<WorkflowDefinition.Edge> edges) {
        List<WorkflowDefinition.Node> allNodes = new ArrayList<>();
        allNodes.add(node("root", "trigger.manual", Map.of()));
        allNodes.addAll(nodes);
        return new WorkflowDefinition("1.0", allNodes, edges, Map.of());
    }

    private static WorkflowDefinition.Node node(String id, String type, Map<String, Object> config) {
        return new WorkflowDefinition.Node(id, type, config);
    }

    private static WorkflowDefinition.Edge edge(String id, String source, String target, String sourcePort) {
        return new WorkflowDefinition.Edge(id, source, target, sourcePort);
    }

    private static Harness harness(WorkflowDefinition definition, Object input,
                                   List<NodeExecutor> executors, int concurrency,
                                   RetryWaitPort retryWait) {
        return harness(definition, input, executors, concurrency, retryWait,
                Clock.fixed(Instant.parse("2026-09-22T00:00:00Z"), ZoneOffset.UTC));
    }

    private static Clock mutableClock(AtomicReference<Instant> now) {
        return new Clock() {
            @Override
            public ZoneOffset getZone() {
                return ZoneOffset.UTC;
            }

            @Override
            public Clock withZone(java.time.ZoneId zone) {
                return this;
            }

            @Override
            public Instant instant() {
                return now.get();
            }
        };
    }

    private static Harness harness(WorkflowDefinition definition, Object input,
                                   List<NodeExecutor> executors, int concurrency,
                                   RetryWaitPort retryWait, Clock clock) {
        return harness(definition, input, executors, concurrency, retryWait, clock, null);
    }

    private static Harness harness(WorkflowDefinition definition, Object input,
                                   List<NodeExecutor> executors, int concurrency,
                                   RetryWaitPort retryWait, Clock clock, Duration heartbeat) {
        UUID executionId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        Instant createdAt = Instant.parse("2026-09-21T00:00:00Z");
        Map<String, NodeExecution> nodes = new LinkedHashMap<>();
        Map<String, NodeExecutionStatus> statuses = new LinkedHashMap<>();
        for (WorkflowDefinition.Node node : definition.nodes()) {
            UUID nodeExecutionId = UUID.randomUUID();
            nodes.put(node.id(), new NodeExecution(nodeExecutionId, executionId, node.id(), node.type(),
                    NodeExecutionStatus.PENDING, Map.of(), null, null, 0, null, null, createdAt, null));
            statuses.put(node.id(), NodeExecutionStatus.PENDING);
        }
        Map<String, GraphState.EdgeState> edges = new LinkedHashMap<>();
        definition.edges().forEach(edge -> edges.put(edge.id(), GraphState.EdgeState.UNKNOWN));
        WorkflowVersion version = new WorkflowVersion(UUID.randomUUID(), workflowId, 1, Map.of(), "1.0",
                UUID.randomUUID(), createdAt);
        ExecutionStatePort.Snapshot snapshot = new ExecutionStatePort.Snapshot(workflowId, workspaceId, version,
                definition, "root", input, new GraphState(statuses, edges), nodes, List.of(), Map.of(),
                "correlation-id", "00-trace", ExecutionStatus.QUEUED);
        ExecutionStatePort.Lease lease = new ExecutionStatePort.Lease(executionId, "test-worker", 1);
        InMemoryState state = new InMemoryState(snapshot, lease);
        ExecutorService nodeExecutor = Executors.newFixedThreadPool(concurrency);
        ScheduledExecutorService timer = Executors.newScheduledThreadPool(2);
        ExecutorService callers = Executors.newSingleThreadExecutor();
        NodeExecutorRegistry registry = new NodeExecutorRegistry(executors.toArray(NodeExecutor[]::new));
        ExecutionRunner runner = heartbeat == null
                ? new ExecutionRunner(state, registry, retryWait, nodeExecutor, timer, clock, concurrency)
                : new ExecutionRunner(state, registry, retryWait, nodeExecutor, timer, clock, concurrency,
                        Duration.ofSeconds(5), heartbeat);
        return new Harness(runner, state, lease, nodeExecutor, timer, callers);
    }

    @FunctionalInterface
    private interface Invoker {
        NodeExecutor.Result invoke(NodeExecutor.Context context, Map<String, Object> config);
    }

    private record Harness(ExecutionRunner runner, InMemoryState state, ExecutionStatePort.Lease lease,
                           ExecutorService nodes, ScheduledExecutorService timer, ExecutorService callers)
            implements AutoCloseable {
        @Override
        public void close() {
            runner.close();
            callers.shutdownNow();
            nodes.shutdownNow();
            timer.shutdownNow();
        }
    }

    private static final class InMemoryState implements ExecutionStatePort {
        private volatile Snapshot snapshot;
        private final Lease lease;
        private volatile boolean leaseLive = true;
        private volatile AtomicBoolean cancelFlag = new AtomicBoolean();

        private InMemoryState(Snapshot snapshot, Lease lease) {
            this.snapshot = snapshot;
            this.lease = lease;
        }

        @Override
        public Optional<Lease> claim(UUID executionId, String owner, java.time.Duration leaseDuration) {
            return Optional.of(lease);
        }

        @Override
        public boolean renew(Lease lease, java.time.Duration leaseDuration) {
            return leaseLive && this.lease.equals(lease);
        }

        @Override
        public Snapshot load(Lease lease) {
            if (!this.lease.equals(lease)) {
                throw new IllegalStateException("unknown lease");
            }
            return snapshot;
        }

        @Override
        public synchronized boolean commit(Lease lease, Transition transition) {
            if (!this.lease.equals(lease)) {
                return false;
            }
            Map<String, NodeExecution> nodes = new LinkedHashMap<>();
            transition.nodes().forEach(node -> nodes.put(node.getNodeId(), node));
            snapshot = new Snapshot(snapshot.workflowId(), snapshot.workspaceId(), snapshot.version(),
                    snapshot.definition(), snapshot.firingRoot(), snapshot.input(), transition.graph(), nodes,
                    transition.attempts(), transition.nextAttempts(), snapshot.correlationId(), snapshot.traceparent(),
                    transition.status(), snapshot.workflowName());
            return true;
        }

        @Override
        public boolean isCancelRequested(UUID executionId) {
            return cancelFlag.get();
        }

        @Override
        public void release(Lease lease) {
            // The in-memory fixture does not need a release marker.
        }

        synchronized void markFailedByRecovery(String nodeId, Map<String, Object> error) {
            NodeExecution old = snapshot.nodes().get(nodeId);
            Map<String, NodeExecution> nodes = new LinkedHashMap<>(snapshot.nodes());
            nodes.put(nodeId, new NodeExecution(old.getId(), old.getExecutionId(), nodeId, old.getNodeType(),
                    NodeExecutionStatus.FAILED, old.getInput(), null, error, 1, Instant.parse("2026-09-22T00:00:00Z"),
                    Instant.parse("2026-09-22T00:00:00Z"), old.getCreatedAt(), null));
            // The root already succeeded in the crashed run, so the new owner skips initialization.
            NodeExecution root = snapshot.nodes().get("root");
            nodes.put("root", new NodeExecution(root.getId(), root.getExecutionId(), "root", root.getNodeType(),
                    NodeExecutionStatus.SUCCESS, root.getInput(), Map.of("input", Map.of()), null, 0,
                    Instant.parse("2026-09-22T00:00:00Z"), Instant.parse("2026-09-22T00:00:00Z"),
                    root.getCreatedAt(), null));
            Map<String, NodeExecutionStatus> statuses = new LinkedHashMap<>(snapshot.graph().nodes());
            statuses.put("root", NodeExecutionStatus.SUCCESS);
            statuses.put(nodeId, NodeExecutionStatus.FAILED);
            snapshot = new Snapshot(snapshot.workflowId(), snapshot.workspaceId(), snapshot.version(),
                    snapshot.definition(), snapshot.firingRoot(), snapshot.input(),
                    new GraphState(statuses, snapshot.graph().edges()), nodes, snapshot.attempts(),
                    snapshot.nextAttempts(), snapshot.correlationId(), snapshot.traceparent(), ExecutionStatus.RUNNING);
        }

        /** A run recovered after a crash: the trigger already finished, the rest never started. */
        synchronized void markRootDone() {
            NodeExecution root = snapshot.nodes().get("root");
            Map<String, NodeExecution> nodes = new LinkedHashMap<>(snapshot.nodes());
            nodes.put("root", new NodeExecution(root.getId(), root.getExecutionId(), "root", root.getNodeType(),
                    NodeExecutionStatus.SUCCESS, root.getInput(), Map.of("input", Map.of()), null, 0,
                    Instant.parse("2026-09-22T00:00:00Z"), Instant.parse("2026-09-22T00:00:00Z"),
                    root.getCreatedAt(), null));
            Map<String, NodeExecutionStatus> statuses = new LinkedHashMap<>(snapshot.graph().nodes());
            statuses.put("root", NodeExecutionStatus.SUCCESS);
            snapshot = new Snapshot(snapshot.workflowId(), snapshot.workspaceId(), snapshot.version(),
                    snapshot.definition(), snapshot.firingRoot(), snapshot.input(),
                    new GraphState(statuses, snapshot.graph().edges()), nodes, snapshot.attempts(),
                    snapshot.nextAttempts(), snapshot.correlationId(), snapshot.traceparent(),
                    ExecutionStatus.RUNNING, snapshot.workflowName());
        }

        Snapshot snapshot() {
            return snapshot;
        }

        String summary() {
            return "status=" + snapshot.status() + ", nodes=" + snapshot.nodes().entrySet().stream()
                    .map(entry -> entry.getKey() + "=" + entry.getValue().getStatus()
                            + ":" + entry.getValue().getError() + "/" + entry.getValue().getAttemptCount())
                    .toList()
                    + ", attempts=" + snapshot.attempts().stream()
                    .map(attempt -> attempt.getAttemptNumber() + "=" + attempt.getStatus()
                            + ":" + attempt.getError()).toList();
        }
    }
}
