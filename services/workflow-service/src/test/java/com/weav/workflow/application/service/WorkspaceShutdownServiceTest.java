package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.TelegramWebhookPort;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionOperations;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WorkspaceShutdownServiceTest {

    private static final UUID WORKSPACE = UUID.randomUUID();
    private static final UUID BOT = UUID.randomUUID();

    private final WorkflowRepository workflows = mock(WorkflowRepository.class);
    private final WorkflowTriggerPort triggers = mock(WorkflowTriggerPort.class);
    private final TelegramWebhookPort telegram = mock(TelegramWebhookPort.class);
    private final WorkspaceShutdownService service = new WorkspaceShutdownService(
            workflows, triggers, Optional.of(telegram), TransactionOperations.withoutTransaction());

    @Test
    void pausesPublishedWorkflowsDisablesTriggersAndUnregistersAnUnusedBot() {
        UUID workflowId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        publishedWorkflow(workflowId, versionId);
        when(workflows.findIdsByWorkspaceAndStatus(WORKSPACE, WorkflowStatus.PAUSED)).thenReturn(List.of(UUID.randomUUID()));
        when(workflows.findIdsByWorkspaceAndStatus(WORKSPACE, WorkflowStatus.PUBLISHED)).thenReturn(List.of(workflowId));
        WorkflowTrigger trigger = telegramTrigger();
        when(triggers.findCurrent(workflowId, versionId)).thenReturn(List.of(trigger));
        when(triggers.hasActiveTelegramTrigger(BOT)).thenReturn(false);

        WorkspaceShutdownService.Result result = service.pauseAll(WORKSPACE);

        assertEquals(new WorkspaceShutdownService.Result(1, 1, 0, 0), result);
        verify(triggers).setCurrentEnabled(eq(workflowId), eq(versionId), eq(false), any(), eq(Map.of()));
        verify(telegram).unregister(WORKSPACE, BOT);
    }

    @Test
    void countsTelegramFailuresButStillCompletes() {
        UUID workflowId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        publishedWorkflow(workflowId, versionId);
        when(workflows.findIdsByWorkspaceAndStatus(WORKSPACE, WorkflowStatus.PAUSED)).thenReturn(List.of());
        when(workflows.findIdsByWorkspaceAndStatus(WORKSPACE, WorkflowStatus.PUBLISHED)).thenReturn(List.of(workflowId));
        WorkflowTrigger trigger = telegramTrigger();
        when(triggers.findCurrent(workflowId, versionId)).thenReturn(List.of(trigger));
        when(triggers.hasActiveTelegramTrigger(BOT)).thenThrow(new IllegalStateException("db"));

        assertEquals(new WorkspaceShutdownService.Result(1, 0, 1, 0), service.pauseAll(WORKSPACE));
        verify(telegram, never()).unregister(any(), any());
    }

    @Test
    void aWorkflowPausedByAnotherCallerBetweenListingAndLockCountsAsAlreadyPaused() {
        UUID workflowId = UUID.randomUUID();
        when(workflows.findIdsByWorkspaceAndStatus(WORKSPACE, WorkflowStatus.PAUSED)).thenReturn(List.of());
        when(workflows.findIdsByWorkspaceAndStatus(WORKSPACE, WorkflowStatus.PUBLISHED)).thenReturn(List.of(workflowId));
        when(workflows.lockByWorkspaceAndId(WORKSPACE, workflowId)).thenReturn(Optional.empty());

        assertEquals(new WorkspaceShutdownService.Result(0, 1, 0, 0), service.pauseAll(WORKSPACE));
        verify(workflows, never()).save(any());
    }

    @Test
    void aWorkflowThatThrowsIsCountedAndTheOthersAreStillPaused() {
        UUID broken = UUID.randomUUID();
        UUID ok = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        publishedWorkflow(ok, versionId);
        when(workflows.lockByWorkspaceAndId(WORKSPACE, broken)).thenThrow(new IllegalStateException("lock timeout"));
        when(workflows.findIdsByWorkspaceAndStatus(WORKSPACE, WorkflowStatus.PAUSED)).thenReturn(List.of());
        when(workflows.findIdsByWorkspaceAndStatus(WORKSPACE, WorkflowStatus.PUBLISHED))
                .thenReturn(List.of(broken, ok));
        when(triggers.findCurrent(ok, versionId)).thenReturn(List.of());

        assertEquals(new WorkspaceShutdownService.Result(1, 0, 0, 1), service.pauseAll(WORKSPACE));
        verify(triggers).setCurrentEnabled(eq(ok), eq(versionId), eq(false), any(), eq(Map.of()));
        verify(triggers, never()).setCurrentEnabled(eq(broken), any(), eq(false), any(), any());
    }

    private void publishedWorkflow(UUID workflowId, UUID versionId) {
        Workflow workflow = mock(Workflow.class);
        when(workflow.getStatus()).thenReturn(WorkflowStatus.PUBLISHED);
        when(workflow.getCurrentVersionId()).thenReturn(versionId);
        when(workflows.lockByWorkspaceAndId(WORKSPACE, workflowId)).thenReturn(Optional.of(workflow));
    }

    private static WorkflowTrigger telegramTrigger() {
        WorkflowTrigger trigger = mock(WorkflowTrigger.class);
        when(trigger.getType()).thenReturn(TriggerType.TELEGRAM);
        when(trigger.getStatus()).thenReturn(TriggerStatus.ACTIVE);
        when(trigger.getConfig()).thenReturn(Map.of("connectionId", BOT.toString()));
        return trigger;
    }
}
