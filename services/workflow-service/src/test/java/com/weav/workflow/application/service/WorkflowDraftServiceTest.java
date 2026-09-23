package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.ConnectionReferenceUnavailableException;
import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.usecase.CreateWorkflowUseCase;
import com.weav.workflow.domain.definition.DefinitionValidator;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WorkflowDraftServiceTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-000000000071");
    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000071");
    private static final UUID WORKFLOW_ID = UUID.fromString("40000000-0000-0000-0000-000000000071");
    private static final UUID CONNECTION_ID = UUID.fromString("30000000-0000-0000-0000-000000000071");

    @Test
    void connectionBearingSaveFailsClosedUntilTask7ReferenceProjectionIsAvailable() {
        WorkflowRepository repository = mock(WorkflowRepository.class);
        WorkspaceConnectionPort workspaceConnections = mock(WorkspaceConnectionPort.class);
        Workflow existing = Workflow.createDraft(WORKSPACE_ID, "Existing", null, USER_ID);
        when(repository.findByWorkspaceAndId(WORKSPACE_ID, WORKFLOW_ID)).thenReturn(Optional.of(existing));
        WorkflowDraftService service = new WorkflowDraftService(
                new CreateWorkflowUseCase(repository), repository,
                new WorkspaceAuthorization((workspace, user) -> new WorkspaceAccessPort.Access(
                        workspace, user, "MEMBER", Set.of("WORKFLOW_EDIT"))),
                workspaceConnections, Optional.empty());
        WorkflowDefinition definition = new WorkflowDefinition("1.0", List.of(
                new WorkflowDefinition.Node("manual", "trigger.manual", Map.of()),
                new WorkflowDefinition.Node("sheets", "google.sheets", Map.of(
                        "connectionId", CONNECTION_ID.toString()))), List.of(), Map.of());

        assertThrows(ConnectionReferenceUnavailableException.class,
                () -> service.save(WORKSPACE_ID, WORKFLOW_ID, USER_ID,
                        "Must not save", null, definition, Map.of()));

        verify(workspaceConnections, never()).authorizeAttachment(WORKSPACE_ID, CONNECTION_ID, USER_ID);
        verify(repository, never()).lockByWorkspaceAndId(WORKSPACE_ID, WORKFLOW_ID);
        verify(repository, never()).save(existing);
    }

    @Test
    void removingAnExistingConnectionAlsoFailsClosedWithoutTheTask7ReferenceProjection() {
        WorkflowRepository repository = mock(WorkflowRepository.class);
        WorkspaceConnectionPort workspaceConnections = mock(WorkspaceConnectionPort.class);
        Map<String, Object> existingDefinition = Map.of(
                "schemaVersion", "1.0",
                "nodes", List.of(
                        Map.of("id", "manual", "type", "trigger.manual", "config", Map.of()),
                        Map.of("id", "sheets", "type", "google.sheets", "config",
                                Map.of("connectionId", CONNECTION_ID.toString()))),
                "edges", List.of(),
                "variables", Map.of());
        Instant now = Instant.now();
        Workflow existing = new Workflow(WORKFLOW_ID, WORKSPACE_ID, "Existing", null,
                WorkflowStatus.DRAFT, "1.0", existingDefinition,
                null, null, USER_ID, now, now, null, null, null);
        when(repository.findByWorkspaceAndId(WORKSPACE_ID, WORKFLOW_ID)).thenReturn(Optional.of(existing));
        WorkflowDraftService service = new WorkflowDraftService(
                new CreateWorkflowUseCase(repository), repository,
                new WorkspaceAuthorization((workspace, user) -> new WorkspaceAccessPort.Access(
                        workspace, user, "MEMBER", Set.of("WORKFLOW_EDIT"))),
                workspaceConnections, Optional.empty());
        WorkflowDefinition definition = new WorkflowDefinition("1.0", List.of(
                new WorkflowDefinition.Node("manual", "trigger.manual", Map.of())), List.of(), Map.of());

        assertThrows(ConnectionReferenceUnavailableException.class,
                () -> service.save(WORKSPACE_ID, WORKFLOW_ID, USER_ID,
                        "Must not detach", null, definition, Map.of()));

        verify(workspaceConnections, never()).authorizeAttachment(WORKSPACE_ID, CONNECTION_ID, USER_ID);
        verify(repository, never()).lockByWorkspaceAndId(WORKSPACE_ID, WORKFLOW_ID);
        verify(repository, never()).save(existing);
    }

    @Test
    void missingViewCapabilityIsRejectedBeforeAnyWorkflowLookup() {
        WorkflowRepository repository = mock(WorkflowRepository.class);
        WorkflowDraftService service = new WorkflowDraftService(new CreateWorkflowUseCase(repository), repository,
                new WorkspaceAuthorization((workspace, user) -> new WorkspaceAccessPort.Access(
                        workspace, user, "MEMBER", Set.of("WORKFLOW_EDIT"))),
                mock(WorkspaceConnectionPort.class), Optional.empty());

        assertThrows(ForbiddenException.class, () -> service.get(WORKSPACE_ID, WORKFLOW_ID, USER_ID));

        verify(repository, never()).findByWorkspaceAndId(WORKSPACE_ID, WORKFLOW_ID);
    }

    @Test
    void rejectsOverDepthEditorStateBeforeAnyWorkflowLookupOrFreezeRecursion() {
        WorkflowRepository repository = mock(WorkflowRepository.class);
        WorkflowDraftService service = new WorkflowDraftService(new CreateWorkflowUseCase(repository), repository,
                new WorkspaceAuthorization((workspace, user) -> new WorkspaceAccessPort.Access(
                        workspace, user, "MEMBER", Set.of("WORKFLOW_EDIT"))),
                mock(WorkspaceConnectionPort.class), Optional.empty());
        Map<String, Object> editorState = new LinkedHashMap<>();
        Map<String, Object> cursor = editorState;
        for (int depth = 0; depth < DefinitionValidator.MAX_JSON_DEPTH; depth++) {
            Map<String, Object> child = new LinkedHashMap<>();
            cursor.put("nested", child);
            cursor = child;
        }
        cursor.put("leaf", "bounded");
        WorkflowDefinition definition = new WorkflowDefinition("1.0", List.of(
                new WorkflowDefinition.Node("manual", "trigger.manual", Map.of())), List.of(), Map.of());

        assertThrows(BadRequestException.class, () -> service.save(WORKSPACE_ID, WORKFLOW_ID, USER_ID,
                "Too deep", null, definition, editorState));

        verify(repository, never()).findByWorkspaceAndId(WORKSPACE_ID, WORKFLOW_ID);
        verify(repository, never()).lockByWorkspaceAndId(WORKSPACE_ID, WORKFLOW_ID);
        verify(repository, never()).save(org.mockito.ArgumentMatchers.any());
    }
}
