package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.ExecutionStatePort;
import com.weav.workflow.application.port.out.ExecutionStatePort.CancelResult;
import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.domain.exception.ResourceNotFoundException;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ExecutionCancelServiceTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-09T00:00:00Z"), ZoneOffset.UTC);
    private final UUID workspaceId = UUID.randomUUID();
    private final UUID workflowId = UUID.randomUUID();
    private final UUID executionId = UUID.randomUUID();
    private final UUID actorId = UUID.randomUUID();

    @Test
    void passesTheRequestToTheStateAndReturnsItsResult() {
        assertEquals(CancelResult.REQUESTED, service(Set.of("WORKFLOW_RUN"), CancelResult.REQUESTED).cancel(
                workspaceId, workflowId, executionId, actorId));
        assertEquals(CancelResult.CANCELLED, service(Set.of("WORKFLOW_RUN"), CancelResult.CANCELLED).cancel(
                workspaceId, workflowId, executionId, actorId));
    }

    @Test
    void requiresTheRunCapability() {
        assertThrows(ForbiddenException.class, () -> service(Set.of("WORKFLOW_MONITOR"), CancelResult.REQUESTED)
                .cancel(workspaceId, workflowId, executionId, actorId));
    }

    @Test
    void mapsNotFoundAndFinishedToDomainErrors() {
        assertThrows(ResourceNotFoundException.class, () -> service(Set.of("WORKFLOW_RUN"), CancelResult.NOT_FOUND)
                .cancel(workspaceId, workflowId, executionId, actorId));
        ExecutionAlreadyFinishedException finished = assertThrows(ExecutionAlreadyFinishedException.class,
                () -> service(Set.of("WORKFLOW_RUN"), CancelResult.ALREADY_FINISHED)
                        .cancel(workspaceId, workflowId, executionId, actorId));
        assertEquals("EXECUTION_ALREADY_FINISHED", finished.getCode());
    }

    private ExecutionCancelService service(Set<String> capabilities, CancelResult result) {
        WorkspaceAccessPort access = (workspace, user) -> new WorkspaceAccessPort.Access(workspace, user, "MEMBER", capabilities);
        ExecutionStatePort state = new ExecutionStatePort() {
            @Override
            public CancelResult requestCancel(UUID ws, UUID wf, UUID id, Instant at) {
                assertEquals(CLOCK.instant(), at);
                return result;
            }

            @Override public java.util.Optional<Lease> claim(UUID id, String owner, java.time.Duration d) { return java.util.Optional.empty(); }
            @Override public boolean renew(Lease lease, java.time.Duration d) { return false; }
            @Override public Snapshot load(Lease lease) { throw new UnsupportedOperationException(); }
            @Override public boolean commit(Lease lease, Transition transition) { return false; }
            @Override public void release(Lease lease) { }
        };
        return new ExecutionCancelService(new WorkspaceAuthorization(access), state, CLOCK);
    }
}
