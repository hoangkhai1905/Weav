package com.weav.workflow.domain.definition;

import com.weav.workflow.domain.model.aggregate.execution.ExecutionLog;
import com.weav.workflow.domain.model.aggregate.execution.NodeExecution;
import com.weav.workflow.domain.model.aggregate.execution.NodeExecutionAttempt;
import com.weav.workflow.domain.model.aggregate.execution.WorkflowExecution;
import com.weav.workflow.domain.model.aggregate.workflow.OutboxEvent;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowVersion;
import com.weav.workflow.domain.valueobject.AttemptStatus;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import com.weav.workflow.domain.valueobject.LogLevel;
import com.weav.workflow.domain.valueobject.NodeExecutionStatus;
import com.weav.workflow.domain.valueobject.OutboxStatus;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JsonValuesTest {
    private static final Instant NOW = Instant.parse("2026-09-21T00:00:00Z");
    private static final Instant STARTED_AT = NOW.minusSeconds(60);
    private static final Instant FINISHED_AT = NOW.plusSeconds(60);

    @Test
    void freezesNestedJsonWithoutLosingNull() {
        var nested = new LinkedHashMap<String, Object>();
        nested.put("value", null);
        var source = new LinkedHashMap<String, Object>();
        source.put("nested", nested);
        source.put("explicitNull", null);

        var frozen = JsonValues.freezeMap(source);
        nested.put("value", "changed");
        source.put("explicitNull", "changed");

        Map<?, ?> frozenNested = (Map<?, ?>) frozen.get("nested");
        assertTrue(frozenNested.containsKey("value"));
        assertNull(frozenNested.get("value"));
        assertTrue(frozen.containsKey("explicitNull"));
        assertNull(frozen.get("explicitNull"));
        assertThrows(UnsupportedOperationException.class, () -> frozen.put("x", 1));
        assertThrows(UnsupportedOperationException.class, () -> putValue(frozenNested));
    }

    @Test
    void freezesListsAndPreservesJsonScalarsAndFiniteNumbers() {
        var child = new LinkedHashMap<String, Object>();
        child.put("enabled", true);
        var sourceList = new ArrayList<Object>();
        sourceList.add(null);
        sourceList.add("before");
        sourceList.add(7);
        sourceList.add(new BigInteger("9007199254740993"));
        sourceList.add(new BigDecimal("123.4500"));
        sourceList.add(0.5f);
        sourceList.add(1.25d);
        sourceList.add(child);
        var source = new LinkedHashMap<String, Object>();
        source.put("values", sourceList);
        source.put("enabled", false);
        source.put("name", "json");

        Map<String, Object> frozen = JsonValues.freezeMap(source);
        List<?> frozenList = (List<?>) frozen.get("values");
        sourceList.set(1, "after");
        sourceList.add("later");
        child.put("enabled", false);

        assertNotSame(sourceList, frozenList);
        assertEquals(8, frozenList.size());
        assertNull(frozenList.get(0));
        assertEquals("before", frozenList.get(1));
        assertEquals(Integer.valueOf(7), frozenList.get(2));
        assertEquals(new BigInteger("9007199254740993"), frozenList.get(3));
        assertEquals(new BigDecimal("123.4500"), frozenList.get(4));
        assertEquals(Float.valueOf(0.5f), frozenList.get(5));
        assertEquals(Double.valueOf(1.25d), frozenList.get(6));
        Map<?, ?> frozenChild = (Map<?, ?>) frozenList.get(7);
        assertNotSame(child, frozenChild);
        assertEquals(Boolean.TRUE, frozenChild.get("enabled"));
        assertEquals(Boolean.FALSE, frozen.get("enabled"));
        assertEquals("json", frozen.get("name"));
        assertThrows(UnsupportedOperationException.class, () -> addValue(frozenList));
        assertThrows(UnsupportedOperationException.class, () -> putValue(frozenChild));
    }

    @Test
    void rejectsMutableBigIntegerSubclass() {
        var mutableInteger = new MutableBigInteger();
        assertEquals("1", mutableInteger.toString());
        assertThrows(IllegalArgumentException.class, () -> JsonValues.freeze(mutableInteger));
        mutableInteger.visible = 2;
        assertEquals("2", mutableInteger.toString());
    }

    @Test
    void rejectsMutableBigDecimalSubclass() {
        var mutableDecimal = new MutableBigDecimal();
        assertEquals("1.00", mutableDecimal.toString());
        assertThrows(IllegalArgumentException.class, () -> JsonValues.freeze(mutableDecimal));
        mutableDecimal.visible = "2.00";
        assertEquals("2.00", mutableDecimal.toString());
    }

    @Test
    void preservesRootJsonNullAndKeepsAbsentOptionalMapsEmpty() {
        assertNull(JsonValues.freeze(null));
        assertEquals(Map.of(), JsonValues.freezeMap(null));
    }

    @Test
    void rejectsNonJsonObjectsNonStringKeysMutableNumbersAndNonFiniteNumbers() {
        assertThrows(IllegalArgumentException.class, () -> JsonValues.freeze(new Object()));
        assertThrows(IllegalArgumentException.class, () -> JsonValues.freeze(UUID.randomUUID()));
        assertThrows(IllegalArgumentException.class, () -> JsonValues.freeze('x'));
        assertThrows(IllegalArgumentException.class, () -> JsonValues.freeze(new AtomicInteger(1)));
        assertThrows(IllegalArgumentException.class, () -> JsonValues.freeze(Float.NaN));
        assertThrows(IllegalArgumentException.class, () -> JsonValues.freeze(Double.POSITIVE_INFINITY));
        assertThrows(IllegalArgumentException.class, () -> JsonValues.freeze(Float.NEGATIVE_INFINITY));

        var invalidKeys = new LinkedHashMap<Object, Object>();
        invalidKeys.put("valid", 1);
        invalidKeys.put(2, "invalid JSON object key");
        assertThrows(IllegalArgumentException.class, () -> JsonValues.freeze(invalidKeys));
    }

    @Test
    void rejectsCyclicContainers() {
        var cyclicMap = new LinkedHashMap<String, Object>();
        cyclicMap.put("self", cyclicMap);
        var cyclicList = new ArrayList<Object>();
        cyclicList.add(cyclicList);

        assertThrows(IllegalArgumentException.class, () -> JsonValues.freeze(cyclicMap));
        assertThrows(IllegalArgumentException.class, () -> JsonValues.freeze(cyclicList));
    }

    @Test
    void aggregateConstructorsCopyNestedJsonIntoIndependentSnapshots() {
        UUID workflowId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        UUID executionId = UUID.randomUUID();
        UUID nodeExecutionId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        Map<String, Object> source = mutableJson();

        Workflow workflow = new Workflow(workflowId, workspaceId, "Workflow", null, WorkflowStatus.DRAFT,
                "1.0", source, source, null, userId, NOW, NOW, null, null, null);
        WorkflowVersion version = new WorkflowVersion(versionId, workflowId, 1, source, "1.0", userId, NOW);
        WorkflowTrigger trigger = new WorkflowTrigger(UUID.randomUUID(), workflowId, versionId, "schedule-1",
                TriggerType.SCHEDULE, TriggerStatus.ACTIVE, source, null, null, null, null, source, NOW, NOW);
        WorkflowExecution execution = new WorkflowExecution(executionId, workflowId, versionId,
                ExecutionTriggerType.MANUAL, ExecutionStatus.QUEUED, userId, source, source, source,
                null, null, NOW);
        NodeExecution nodeExecution = new NodeExecution(nodeExecutionId, executionId, "node-1", "http.request",
                NodeExecutionStatus.PENDING, source, source, source, 0, null, null, NOW);
        NodeExecutionAttempt attempt = new NodeExecutionAttempt(attemptId, nodeExecutionId, 1, AttemptStatus.RUNNING,
                source, source, source, NOW, null, NOW);
        ExecutionLog log = new ExecutionLog(UUID.randomUUID(), executionId, nodeExecutionId, attemptId,
                LogLevel.INFO, "NODE_STARTED", "Node started", source, NOW);
        OutboxEvent outboxEvent = new OutboxEvent(UUID.randomUUID(), "WorkflowExecution", executionId,
                "execution.requested", source, OutboxStatus.PENDING, NOW, null, 0);

        mutateJson(source);

        for (Map<String, Object> snapshot : List.of(
                workflow.getDraftDefinition(), workflow.getEditorState(), version.getDefinition(),
                trigger.getConfig(), trigger.getLastError(), objectInput(execution), execution.getOutput(), execution.getError(),
                nodeExecution.getInput(), nodeExecution.getOutput(), nodeExecution.getError(),
                attempt.getInput(), attempt.getOutput(), attempt.getError(), log.getMetadata(), outboxEvent.getPayload())) {
            assertJsonSnapshot(snapshot);
        }
        assertEquals(WorkflowStatus.DRAFT, workflow.getStatus());
        assertEquals(ExecutionStatus.QUEUED, execution.getStatus());
        assertEquals(NodeExecutionStatus.PENDING, nodeExecution.getStatus());
        assertEquals(AttemptStatus.RUNNING, attempt.getStatus());
        assertEquals(OutboxStatus.PENDING, outboxEvent.getStatus());
    }

    @Test
    void aggregateUpdatesCopyJsonOutputsAndErrors() {
        UUID workflowId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        UUID executionId = UUID.randomUUID();
        UUID nodeExecutionId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();

        WorkflowExecution execution = new WorkflowExecution(executionId, workflowId, versionId,
                ExecutionTriggerType.MANUAL, ExecutionStatus.QUEUED, userId, Map.of(), Map.of(), Map.of(),
                null, null, NOW);
        Map<String, Object> errorSource = mutableJson();
        execution.fail(NOW, errorSource);
        mutateJson(errorSource);
        assertJsonSnapshot(execution.getError());
        assertEquals(ExecutionStatus.FAILED, execution.getStatus());

        NodeExecution nodeExecution = new NodeExecution(nodeExecutionId, executionId, "node-1", "http.request",
                NodeExecutionStatus.PENDING, Map.of(), Map.of(), Map.of(), 0, null, null, NOW);
        Map<String, Object> outputSource = mutableJson();
        nodeExecution.complete(NOW, outputSource);
        mutateJson(outputSource);
        assertJsonSnapshot(nodeExecution.getOutput());
        assertEquals(NodeExecutionStatus.SUCCESS, nodeExecution.getStatus());

        NodeExecutionAttempt attempt = new NodeExecutionAttempt(UUID.randomUUID(), nodeExecutionId, 1,
                AttemptStatus.RUNNING, Map.of(), Map.of(), Map.of(), NOW, null, NOW);
        Map<String, Object> attemptOutputSource = mutableJson();
        attempt.succeed(attemptOutputSource, NOW);
        mutateJson(attemptOutputSource);
        assertJsonSnapshot(attempt.getOutput());
        assertEquals(AttemptStatus.SUCCESS, attempt.getStatus());
    }

    @Test
    void failedWorkflowUpdateKeepsStateWhenDetailsAreInvalidOrCyclic() {
        var execution = new WorkflowExecution(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                ExecutionTriggerType.MANUAL, ExecutionStatus.RUNNING, UUID.randomUUID(), Map.of(),
                Map.of("existing", "output"), Map.of("existing", "error"), STARTED_AT, null, NOW);
        Map<String, Object> originalOutput = execution.getOutput();
        Map<String, Object> originalError = execution.getError();

        for (Map<String, Object> rejected : invalidJsonValues()) {
            assertThrows(IllegalArgumentException.class, () -> execution.fail(FINISHED_AT, rejected));
            assertEquals(ExecutionStatus.RUNNING, execution.getStatus());
            assertEquals(STARTED_AT, execution.getStartedAt());
            assertNull(execution.getFinishedAt());
            assertSame(originalOutput, execution.getOutput());
            assertSame(originalError, execution.getError());
        }

        Map<String, Object> validDetails = jsonWithExplicitNull();
        execution.fail(FINISHED_AT, validDetails);
        validDetails.put("result", "mutated after update");
        assertEquals(ExecutionStatus.FAILED, execution.getStatus());
        assertEquals(STARTED_AT, execution.getStartedAt());
        assertEquals(FINISHED_AT, execution.getFinishedAt());
        assertSame(originalOutput, execution.getOutput());
        assertTrue(execution.getError().containsKey("result"));
        assertNull(execution.getError().get("result"));
    }

    @Test
    void nodeCompletionKeepsStateWhenOutputIsInvalidOrCyclic() {
        var nodeExecution = new NodeExecution(UUID.randomUUID(), UUID.randomUUID(), "node-1", "http.request",
                NodeExecutionStatus.RUNNING, Map.of(), Map.of("existing", "output"), Map.of("existing", "error"),
                2, STARTED_AT, null, NOW);
        Map<String, Object> originalOutput = nodeExecution.getOutput();
        Map<String, Object> originalError = nodeExecution.getError();

        for (Map<String, Object> rejected : invalidJsonValues()) {
            assertThrows(IllegalArgumentException.class, () -> nodeExecution.complete(FINISHED_AT, rejected));
            assertEquals(NodeExecutionStatus.RUNNING, nodeExecution.getStatus());
            assertEquals(STARTED_AT, nodeExecution.getStartedAt());
            assertNull(nodeExecution.getFinishedAt());
            assertSame(originalOutput, nodeExecution.getOutput());
            assertSame(originalError, nodeExecution.getError());
        }

        Map<String, Object> validOutput = jsonWithExplicitNull();
        nodeExecution.complete(FINISHED_AT, validOutput);
        validOutput.put("result", "mutated after update");
        assertEquals(NodeExecutionStatus.SUCCESS, nodeExecution.getStatus());
        assertEquals(STARTED_AT, nodeExecution.getStartedAt());
        assertEquals(FINISHED_AT, nodeExecution.getFinishedAt());
        assertSame(originalError, nodeExecution.getError());
        assertTrue(nodeExecution.getOutput().containsKey("result"));
        assertNull(nodeExecution.getOutput().get("result"));
    }

    @Test
    void attemptSuccessKeepsStateWhenOutputIsInvalidOrCyclic() {
        var attempt = new NodeExecutionAttempt(UUID.randomUUID(), UUID.randomUUID(), 1, AttemptStatus.RUNNING,
                Map.of(), Map.of("existing", "output"), Map.of("existing", "error"), STARTED_AT, null, NOW);
        Map<String, Object> originalOutput = attempt.getOutput();
        Map<String, Object> originalError = attempt.getError();

        for (Map<String, Object> rejected : invalidJsonValues()) {
            assertThrows(IllegalArgumentException.class, () -> attempt.succeed(rejected, FINISHED_AT));
            assertEquals(AttemptStatus.RUNNING, attempt.getStatus());
            assertEquals(STARTED_AT, attempt.getStartedAt());
            assertNull(attempt.getFinishedAt());
            assertSame(originalOutput, attempt.getOutput());
            assertSame(originalError, attempt.getError());
        }

        Map<String, Object> validOutput = jsonWithExplicitNull();
        attempt.succeed(validOutput, FINISHED_AT);
        validOutput.put("result", "mutated after update");
        assertEquals(AttemptStatus.SUCCESS, attempt.getStatus());
        assertEquals(STARTED_AT, attempt.getStartedAt());
        assertEquals(FINISHED_AT, attempt.getFinishedAt());
        assertSame(originalError, attempt.getError());
        assertTrue(attempt.getOutput().containsKey("result"));
        assertNull(attempt.getOutput().get("result"));
    }

    private static Map<String, Object> mutableJson() {
        var nested = new LinkedHashMap<String, Object>();
        nested.put("value", null);
        var values = new ArrayList<Object>();
        values.add("before");
        values.add(null);
        var source = new LinkedHashMap<String, Object>();
        source.put("nested", nested);
        source.put("values", values);
        source.put("explicitNull", null);
        return source;
    }

    private static List<Map<String, Object>> invalidJsonValues() {
        var cyclic = new LinkedHashMap<String, Object>();
        cyclic.put("self", cyclic);
        return List.of(Map.of("bad", new Object()), cyclic);
    }

    private static Map<String, Object> jsonWithExplicitNull() {
        var value = new LinkedHashMap<String, Object>();
        value.put("result", null);
        return value;
    }

    private static final class MutableBigInteger extends BigInteger {
        private int visible = 1;

        private MutableBigInteger() {
            super("1");
        }

        @Override
        public String toString() {
            return Integer.toString(visible);
        }
    }

    private static final class MutableBigDecimal extends BigDecimal {
        private String visible = "1.00";

        private MutableBigDecimal() {
            super("1.00");
        }

        @Override
        public String toString() {
            return visible;
        }
    }

    @SuppressWarnings("unchecked")
    private static void mutateJson(Map<String, Object> source) {
        Map<String, Object> nested = (Map<String, Object>) source.get("nested");
        nested.put("value", "changed");
        List<Object> values = (List<Object>) source.get("values");
        values.set(0, "changed");
        values.add("extra");
        source.put("explicitNull", "changed");
    }

    @SuppressWarnings("unchecked")
    private static void putValue(Map<?, ?> map) {
        ((Map<Object, Object>) map).put("x", 1);
    }

    @SuppressWarnings("unchecked")
    private static void addValue(List<?> list) {
        ((List<Object>) list).add("x");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> objectInput(WorkflowExecution execution) {
        return (Map<String, Object>) execution.getInput();
    }

    @SuppressWarnings("unchecked")
    private static void assertJsonSnapshot(Map<String, Object> snapshot) {
        assertEquals(3, snapshot.size());
        Map<String, Object> nested = (Map<String, Object>) snapshot.get("nested");
        assertTrue(nested.containsKey("value"));
        assertNull(nested.get("value"));
        List<Object> values = (List<Object>) snapshot.get("values");
        assertEquals(2, values.size());
        assertEquals("before", values.get(0));
        assertNull(values.get(1));
        assertTrue(snapshot.containsKey("explicitNull"));
        assertNull(snapshot.get("explicitNull"));
        assertThrows(UnsupportedOperationException.class, () -> snapshot.put("x", 1));
        assertThrows(UnsupportedOperationException.class, () -> nested.put("x", 1));
        assertThrows(UnsupportedOperationException.class, () -> values.add("x"));
    }
}
