package com.weav.workflow.application.service;

import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.port.out.ConnectionReferencePort;
import com.weav.workflow.application.port.out.ScheduleValidationPort;
import com.weav.workflow.application.port.out.WebhookSecretPort;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.application.port.out.WorkflowVersionPort;
import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.usecase.CreateWorkflowUseCase;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionOperations;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** X-2: Workspace calls must happen with no transaction (and so no pooled connection) open. */
class TransactionBoundaryTest {
    private static final UUID WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-000000000081");
    private static final UUID ACTOR_ID = UUID.fromString("20000000-0000-0000-0000-000000000081");
    private static final UUID CONNECTION_ID = UUID.fromString("30000000-0000-0000-0000-000000000081");

    private final RecordingTransactions transactions = new RecordingTransactions();
    private final List<String> remoteCalls = new ArrayList<>();
    private final List<String> remoteCallsInTransaction = new ArrayList<>();
    private final List<String> writesOutsideTransaction = new ArrayList<>();

    private final WorkflowRepository workflows = mock(WorkflowRepository.class);
    private final WorkspaceConnectionPort connections = mock(WorkspaceConnectionPort.class);
    private final ConnectionReferencePort references = mock(ConnectionReferencePort.class);
    private final WorkspaceAuthorization authorization = new WorkspaceAuthorization(this::access);
    private Workflow draft;

    private WorkspaceAccessPort.Access access(UUID workspaceId, UUID userId) {
        recordRemote("access");
        return new WorkspaceAccessPort.Access(workspaceId, userId, "MEMBER",
                Set.of("WORKFLOW_EDIT", "WORKFLOW_PUBLISH", "WORKFLOW_CREATE"));
    }

    private void recordRemote(String call) {
        remoteCalls.add(call);
        if (transactions.active) {
            remoteCallsInTransaction.add(call);
        }
    }

    private void arrange() {
        doAnswer(invocation -> {
            recordRemote("attachment");
            return null;
        }).when(connections).authorizeAttachment(any(), any(), any());
        draft = Workflow.createDraft(WORKSPACE_ID, "Boundary", null, ACTOR_ID);
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("method", "GET");
        request.put("url", "https://example.test");
        request.put("connectionId", CONNECTION_ID.toString());
        draft.updateDraft("Boundary", null, Map.of("schemaVersion", "1.0",
                "nodes", List.of(Map.of("id", "manual", "type", "trigger.manual", "config", Map.of()),
                        Map.of("id", "request", "type", "http.request", "config", request)),
                "edges", List.of(Map.of("id", "e1", "source", "manual", "target", "request")),
                "variables", Map.of()), Map.of());
        when(workflows.findByWorkspaceAndId(WORKSPACE_ID, draft.getId())).thenReturn(Optional.of(draft));
        when(workflows.lockByWorkspaceAndId(WORKSPACE_ID, draft.getId())).thenAnswer(invocation -> {
            if (!transactions.active) {
                writesOutsideTransaction.add("lock");
            }
            return Optional.of(draft);
        });
        when(workflows.save(any())).thenAnswer(invocation -> {
            if (!transactions.active) {
                writesOutsideTransaction.add("save");
            }
            return invocation.getArgument(0);
        });
    }

    @Test
    void publishCallsWorkspaceOutsideTheTransactionAndLocksInsideIt() {
        arrange();
        WorkflowVersionPort versions = mock(WorkflowVersionPort.class);
        when(versions.nextNumber(any())).thenReturn(1);
        ScheduleValidationPort schedules = mock(ScheduleValidationPort.class);
        when(schedules.validate(any(), any(), any())).thenReturn(List.of());
        WorkflowPublicationService service = new WorkflowPublicationService(workflows, versions,
                mock(WorkflowTriggerPort.class), authorization, connections, Optional.of(references), schedules,
                mock(WebhookSecretPort.class), event -> { }, transactions);

        service.publish(WORKSPACE_ID, draft.getId(), ACTOR_ID);

        assertEquals(List.of("access", "attachment"), remoteCalls);
        assertTrue(remoteCallsInTransaction.isEmpty(), "no remote call may run inside a transaction");
        assertTrue(writesOutsideTransaction.isEmpty(), "lock and writes must run inside the transaction");
        assertEquals(1, transactions.executions);
    }

    @Test
    void saveCallsWorkspaceOutsideTheTransactionAndLocksInsideIt() {
        arrange();
        WorkflowDraftService service = new WorkflowDraftService(new CreateWorkflowUseCase(workflows), workflows,
                authorization, connections, Optional.of(references), event -> { }, transactions);
        WorkflowDefinition definition = new WorkflowDefinition("1.0", List.of(
                new WorkflowDefinition.Node("manual", "trigger.manual", Map.of()),
                new WorkflowDefinition.Node("request", "http.request", Map.of(
                        "method", "GET", "url", "https://example.test",
                        "connectionId", CONNECTION_ID.toString()))), List.of(), Map.of());

        service.save(WORKSPACE_ID, draft.getId(), ACTOR_ID, "Boundary", null, definition, Map.of());

        assertEquals(List.of("access", "attachment"), remoteCalls);
        assertTrue(remoteCallsInTransaction.isEmpty(), "no remote call may run inside a transaction");
        assertTrue(writesOutsideTransaction.isEmpty(), "lock and writes must run inside the transaction");
        assertEquals(1, transactions.executions);
    }

    @Test
    void createAuthorizesBeforeOpeningTheTransaction() {
        arrange();
        when(workflows.save(any())).thenAnswer(invocation -> {
            assertTrue(transactions.active, "persisting the workflow must happen inside the transaction");
            return invocation.getArgument(0);
        });
        WorkflowDraftService service = new WorkflowDraftService(new CreateWorkflowUseCase(workflows), workflows,
                authorization, connections, Optional.of(references), event -> { }, transactions);

        service.create(new CreateWorkflowCommand(WORKSPACE_ID, ACTOR_ID, "New", null));

        assertEquals(List.of("access"), remoteCalls);
        assertTrue(remoteCallsInTransaction.isEmpty(), "no remote call may run inside a transaction");
        assertEquals(1, transactions.executions);
    }

    private static final class RecordingTransactions implements TransactionOperations {
        boolean active;
        int executions;

        @Override
        public <T> T execute(TransactionCallback<T> action) {
            active = true;
            executions++;
            try {
                return action.doInTransaction(new SimpleTransactionStatus());
            } finally {
                active = false;
            }
        }
    }
}
