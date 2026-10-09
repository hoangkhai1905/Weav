package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.ControlBotStore;
import com.weav.workflow.application.port.out.ExecutionAdmissionPort;
import com.weav.workflow.domain.exception.InvalidStateException;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.json.JsonMapper;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WorkflowEventTriggerServiceTest {
    private static final UUID WORKSPACE = UUID.randomUUID();
    private static final UUID SOURCE_WORKFLOW = UUID.randomUUID();
    private static final UUID EXECUTION = UUID.randomUUID();

    private final ExecutionAdmissionPort port = mock(ExecutionAdmissionPort.class);
    private final List<ControlBotStore.EventListener> listeners = new ArrayList<>();
    private ControlBotStore.FinishedSource source;
    private WorkflowEventTriggerService service;

    @BeforeEach
    void setUp() {
        source = source(ExecutionStatus.FAILED, ExecutionTriggerType.SCHEDULE);
        ExecutionAdmissionService admission = new ExecutionAdmissionService(
                new WorkspaceAuthorization((w, u) -> new WorkspaceAccessPort.Access(w, u, "MEMBER", Set.of())),
                port, JsonMapper.builder().build(), 1_048_576, 32);
        service = new WorkflowEventTriggerService(new Store(), admission, "https://app.example.test/");
        when(port.create(any())).thenAnswer(call -> new ExecutionAdmissionPort.Admission(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), ExecutionStatus.QUEUED));
    }

    private static ControlBotStore.FinishedSource source(ExecutionStatus status, ExecutionTriggerType trigger) {
        return source(status, trigger, null);
    }

    private static ControlBotStore.FinishedSource source(ExecutionStatus status, ExecutionTriggerType trigger,
                                                         String idempotencyKey) {
        return new ControlBotStore.FinishedSource(EXECUTION, SOURCE_WORKFLOW, WORKSPACE, "Báo cáo", status, trigger,
                "HTTP_TIMEOUT", "timed out", Instant.parse("2026-10-09T10:00:00Z"), Instant.parse("2026-10-09T10:00:02Z"),
                idempotencyKey);
    }

    private ControlBotStore.EventListener listener(UUID workflowId, List<String> events, List<String> watched) {
        ControlBotStore.EventListener listener = new ControlBotStore.EventListener(UUID.randomUUID(), workflowId,
                Map.of("events", events, "workflowIds", watched));
        listeners.add(listener);
        return listener;
    }

    @Test
    void failedFiresAFailedListenerWithTheDocumentedInputAndIdempotencyKey() {
        ControlBotStore.EventListener alert = listener(UUID.randomUUID(), List.of("FAILED"), List.of());

        assertEquals(1, service.fire(EXECUTION));

        ArgumentCaptor<ExecutionAdmissionPort.Command> command = ArgumentCaptor.forClass(ExecutionAdmissionPort.Command.class);
        verify(port).create(command.capture());
        assertEquals(alert.triggerId(), command.getValue().triggerId());
        assertEquals("wfevent:" + EXECUTION, command.getValue().idempotencyKey());
        Map<?, ?> input = (Map<?, ?>) command.getValue().input();
        assertEquals(SOURCE_WORKFLOW.toString(), input.get("workflowId"));
        assertEquals("Báo cáo", input.get("workflowName"));
        assertEquals(EXECUTION.toString(), input.get("executionId"));
        assertEquals("FAILED", input.get("status"));
        assertEquals("HTTP_TIMEOUT", input.get("errorCode"));
        assertEquals("timed out", input.get("errorMessage"));
        assertEquals("2026-10-09T10:00:00Z", input.get("startedAt"));
        assertEquals("2026-10-09T10:00:02Z", input.get("finishedAt"));
        assertEquals(2000L, input.get("durationMs"));
        assertEquals("https://app.example.test/executions/" + EXECUTION, input.get("runUrl"));
    }

    @Test
    void successFiresOnlyListenersThatAskedForSucceeded() {
        source = source(ExecutionStatus.SUCCESS, ExecutionTriggerType.MANUAL);
        listener(UUID.randomUUID(), List.of("FAILED"), List.of());
        ControlBotStore.EventListener both = listener(UUID.randomUUID(), List.of("FAILED", "SUCCEEDED"), List.of());

        assertEquals(1, service.fire(EXECUTION));
        ArgumentCaptor<ExecutionAdmissionPort.Command> command = ArgumentCaptor.forClass(ExecutionAdmissionPort.Command.class);
        verify(port).create(command.capture());
        assertEquals(both.triggerId(), command.getValue().triggerId());
        assertEquals("SUCCEEDED", ((Map<?, ?>) command.getValue().input()).get("status"));
    }

    @Test
    void emptyWatchListMeansAllWorkflowsExceptTheListenerItself() {
        listener(SOURCE_WORKFLOW, List.of("FAILED"), List.of()); // would watch itself: never fires
        listener(UUID.randomUUID(), List.of("FAILED"), List.of());

        assertEquals(1, service.fire(EXECUTION));
    }

    @Test
    void aSpecificWatchListOnlyMatchesItsWorkflows() {
        listener(UUID.randomUUID(), List.of("FAILED"), List.of(UUID.randomUUID().toString()));
        listener(UUID.randomUUID(), List.of("FAILED"), List.of(SOURCE_WORKFLOW.toString().toUpperCase()));

        assertEquals(1, service.fire(EXECUTION));
    }

    @Test
    void aRunStartedByTheWorkflowEventTriggerNeverFiresAgain() {
        source = source(ExecutionStatus.FAILED, ExecutionTriggerType.WORKFLOW_EVENT);
        listener(UUID.randomUUID(), List.of("FAILED"), List.of());

        assertEquals(0, service.fire(EXECUTION));
        verify(port, never()).create(any());
    }

    @Test
    void pingPongAndLongerCyclesStopAfterOneRound() {
        // A listens to B and runs B from a bot step (and the same through C): every run started inside the chain is
        // marked, so its failure never fires another event.
        listener(UUID.randomUUID(), List.of("FAILED"), List.of());
        UUID node = UUID.randomUUID();
        com.weav.workflow.application.port.out.ControlBotStore.RunOrigin eventRun =
                new ControlBotStore.RunOrigin(UUID.randomUUID(), UUID.randomUUID(), WORKSPACE, UUID.randomUUID(),
                        ExecutionTriggerType.WORKFLOW_EVENT, "wfevent:" + EXECUTION);
        String bRunKey = com.weav.workflow.application.node.WeavWorkflowNodeExecutor.admissionKey(eventRun, node);
        source = source(ExecutionStatus.FAILED, ExecutionTriggerType.MANUAL, bRunKey);
        assertEquals(0, service.fire(EXECUTION), "A<->B: the run A started in the chain does not fire again");

        ControlBotStore.RunOrigin bRun = new ControlBotStore.RunOrigin(UUID.randomUUID(), UUID.randomUUID(), WORKSPACE,
                UUID.randomUUID(), ExecutionTriggerType.MANUAL, bRunKey);
        String cRunKey = com.weav.workflow.application.node.WeavWorkflowNodeExecutor.admissionKey(bRun, node);
        source = source(ExecutionStatus.FAILED, ExecutionTriggerType.MANUAL, cRunKey);
        assertEquals(0, service.fire(EXECUTION), "A->B->C->A: the marker is transitive");
        verify(port, never()).create(any());
    }

    @Test
    void aRunStartedByTheBotFromANormalTriggerStillFiresAlerts() {
        listener(UUID.randomUUID(), List.of("FAILED"), List.of());
        ControlBotStore.RunOrigin telegramRun = new ControlBotStore.RunOrigin(UUID.randomUUID(), UUID.randomUUID(),
                WORKSPACE, UUID.randomUUID(), ExecutionTriggerType.TELEGRAM, null);
        String key = com.weav.workflow.application.node.WeavWorkflowNodeExecutor.admissionKey(telegramRun, UUID.randomUUID());
        source = source(ExecutionStatus.FAILED, ExecutionTriggerType.MANUAL, key);

        assertEquals(1, service.fire(EXECUTION));
    }

    @Test
    void cancelledRunsNeverFire() {
        source = source(ExecutionStatus.CANCELLED, ExecutionTriggerType.MANUAL);
        listener(UUID.randomUUID(), List.of("FAILED", "SUCCEEDED"), List.of());

        assertEquals(0, service.fire(EXECUTION));
        verify(port, never()).create(any());
    }

    @Test
    void aDuplicateFinishNotificationReusesTheSameIdempotencyKeyPerListener() {
        listener(UUID.randomUUID(), List.of("FAILED"), List.of());

        service.fire(EXECUTION);
        service.fire(EXECUTION);

        ArgumentCaptor<ExecutionAdmissionPort.Command> command = ArgumentCaptor.forClass(ExecutionAdmissionPort.Command.class);
        verify(port, atLeastOnce()).create(command.capture());
        assertEquals(2, command.getAllValues().size());
        assertEquals(command.getAllValues().get(0).idempotencyKey(), command.getAllValues().get(1).idempotencyKey());
        assertEquals(command.getAllValues().get(0).requestHash(), command.getAllValues().get(1).requestHash());
    }

    @Test
    void aListenerThatCannotBeAdmittedDoesNotStopTheOthersOrThrow() {
        listener(UUID.randomUUID(), List.of("FAILED"), List.of());
        listener(UUID.randomUUID(), List.of("FAILED"), List.of());
        when(port.create(any())).thenThrow(new InvalidStateException("paused")).thenAnswer(call ->
                new ExecutionAdmissionPort.Admission(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                        ExecutionStatus.QUEUED));

        service.onExecutionFinished(EXECUTION);

        verify(port, org.mockito.Mockito.times(2)).create(any());
    }

    @Test
    void runUrlIsOmittedWithoutAWebBaseUrl() {
        ExecutionAdmissionService admission = new ExecutionAdmissionService(
                new WorkspaceAuthorization((w, u) -> new WorkspaceAccessPort.Access(w, u, "MEMBER", Set.of())),
                port, JsonMapper.builder().build(), 1_048_576, 32);
        WorkflowEventTriggerService bare = new WorkflowEventTriggerService(new Store(), admission, "");
        listener(UUID.randomUUID(), List.of("FAILED"), List.of());

        bare.fire(EXECUTION);

        ArgumentCaptor<ExecutionAdmissionPort.Command> command = ArgumentCaptor.forClass(ExecutionAdmissionPort.Command.class);
        verify(port).create(command.capture());
        assertFalse(((Map<?, ?>) command.getValue().input()).containsKey("runUrl"));
        assertTrue(((Map<?, ?>) command.getValue().input()).containsKey("errorCode"));
    }

    private final class Store implements ControlBotStore {
        @Override
        public Optional<RunOrigin> runOrigin(UUID executionId) {
            return Optional.empty();
        }

        @Override
        public List<WorkflowRef> workflows(UUID workspaceId) {
            return List.of();
        }

        @Override
        public Set<UUID> existingWorkflowIds(UUID workspaceId, Set<UUID> ids) {
            return Set.of();
        }

        @Override
        public Optional<LastRun> lastFinishedRun(UUID workflowId) {
            return Optional.empty();
        }

        @Override
        public Double successRate(UUID workflowId, Instant since) {
            return null;
        }

        @Override
        public Optional<FinishedSource> finishedSource(UUID executionId) {
            return Optional.of(source);
        }

        @Override
        public List<EventListener> eventListeners(UUID workspaceId) {
            return List.copyOf(listeners);
        }
    }
}
