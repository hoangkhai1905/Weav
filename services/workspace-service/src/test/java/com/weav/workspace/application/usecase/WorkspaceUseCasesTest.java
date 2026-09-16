package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.CreateWorkspaceCommand;
import com.weav.workspace.application.dto.WorkspaceResponse;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.exception.ConflictException;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.exception.InvalidStateException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.exception.WorkspaceNameAlreadyExistsException;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.model.WorkspaceMembershipView;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.query.SortDirection;
import com.weav.workspace.domain.query.WorkspaceListQuery;
import com.weav.workspace.domain.query.WorkspaceSort;
import com.weav.workspace.domain.valueobject.MembershipRole;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WorkspaceUseCasesTest {

    private static final UUID ACTOR = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID OTHER_ACTOR = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final Instant CREATED_AT = Instant.parse("2026-01-02T03:04:05Z");

    @Test
    void createTrimsAndNormalizesNameAndCreatesExactlyOneOwnerInOneTransaction() {
        WorkspaceRepository workspaceRepository = mock(WorkspaceRepository.class);
        MembershipRepository membershipRepository = mock(MembershipRepository.class);
        when(workspaceRepository.existsOwnedNameNormalized(ACTOR, "acme", null)).thenReturn(false);
        when(workspaceRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(membershipRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        RecordingTransactionRunner transactions = new RecordingTransactionRunner();

        WorkspaceResponse response = new CreateWorkspaceUseCase(
                workspaceRepository, membershipRepository, transactions)
                .execute(new CreateWorkspaceCommand(ACTOR, "  Acme  "));

        ArgumentCaptor<Workspace> workspaceCaptor = ArgumentCaptor.forClass(Workspace.class);
        verify(workspaceRepository).save(workspaceCaptor.capture());
        Workspace persisted = workspaceCaptor.getValue();
        assertEquals("Acme", persisted.getName());
        assertEquals("acme", persisted.getNameNormalized());
        assertEquals(ACTOR, persisted.getCreatedBy());
        ArgumentCaptor<Membership> membershipCaptor = ArgumentCaptor.forClass(Membership.class);
        verify(membershipRepository).save(membershipCaptor.capture());
        Membership owner = membershipCaptor.getValue();
        assertEquals(persisted.getId(), owner.getWorkspaceId());
        assertEquals(ACTOR, owner.getUserId());
        assertEquals(MembershipRole.OWNER, owner.getRole());
        assertEquals(1, transactions.requiresNewInvocations);
        assertEquals(persisted.getId(), response.id());
    }

    @Test
    void createUsesMaxPlusOneForOmittedNameAndDoesNotFillGaps() {
        WorkspaceRepository workspaceRepository = mock(WorkspaceRepository.class);
        MembershipRepository membershipRepository = mock(MembershipRepository.class);
        when(workspaceRepository.findMaxDefaultWorkspaceNumberByOwner(ACTOR)).thenReturn(7);
        when(workspaceRepository.existsOwnedNameNormalized(ACTOR, "my workspace 8", null)).thenReturn(false);
        when(workspaceRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(membershipRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        WorkspaceResponse response = new CreateWorkspaceUseCase(
                workspaceRepository, membershipRepository, new RecordingTransactionRunner())
                .execute(new CreateWorkspaceCommand(ACTOR, null));

        assertEquals("My workspace 8", response.name());
        verify(workspaceRepository).existsOwnedNameNormalized(ACTOR, "my workspace 8", null);
    }

    @Test
    void createAllowsSameNameForDifferentOwners() {
        WorkspaceRepository workspaceRepository = mock(WorkspaceRepository.class);
        MembershipRepository membershipRepository = mock(MembershipRepository.class);
        when(workspaceRepository.existsOwnedNameNormalized(OTHER_ACTOR, "shared", null)).thenReturn(false);
        when(workspaceRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(membershipRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        WorkspaceResponse response = new CreateWorkspaceUseCase(
                workspaceRepository, membershipRepository, new RecordingTransactionRunner())
                .execute(new CreateWorkspaceCommand(OTHER_ACTOR, "Shared"));

        assertEquals("Shared", response.name());
        verify(workspaceRepository).existsOwnedNameNormalized(OTHER_ACTOR, "shared", null);
    }

    @Test
    void createRejectsExplicitWhitespaceAndDoesNotStartATransaction() {
        WorkspaceRepository workspaceRepository = mock(WorkspaceRepository.class);
        MembershipRepository membershipRepository = mock(MembershipRepository.class);
        RecordingTransactionRunner transactions = new RecordingTransactionRunner();

        assertThrows(BadRequestException.class, () -> new CreateWorkspaceUseCase(
                workspaceRepository, membershipRepository, transactions)
                .execute(new CreateWorkspaceCommand(ACTOR, "   ")));

        assertEquals(0, transactions.invocations);
        verify(workspaceRepository, never()).save(any());
    }

    @Test
    void createTranslatesPrecheckedDuplicateToStableBusinessCode() {
        WorkspaceRepository workspaceRepository = mock(WorkspaceRepository.class);
        MembershipRepository membershipRepository = mock(MembershipRepository.class);
        when(workspaceRepository.existsOwnedNameNormalized(ACTOR, "acme", null)).thenReturn(true);

        ConflictException exception = assertThrows(ConflictException.class, () -> new CreateWorkspaceUseCase(
                workspaceRepository, membershipRepository, new RecordingTransactionRunner())
                .execute(new CreateWorkspaceCommand(ACTOR, "Acme")));

        assertEquals("WORKSPACE_NAME_ALREADY_EXISTS", exception.getCode());
        verify(workspaceRepository, never()).save(any());
    }

    @Test
    void generatedNameRetriesInSeparateTransactionsAfterUniqueConflict() {
        WorkspaceRepository workspaceRepository = mock(WorkspaceRepository.class);
        MembershipRepository membershipRepository = mock(MembershipRepository.class);
        when(workspaceRepository.findMaxDefaultWorkspaceNumberByOwner(ACTOR)).thenReturn(3, 4);
        when(workspaceRepository.existsOwnedNameNormalized(any(), any(), any())).thenReturn(false);
        when(workspaceRepository.save(any()))
                .thenThrow(new WorkspaceNameAlreadyExistsException())
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(membershipRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        RecordingTransactionRunner transactions = new RecordingTransactionRunner();

        WorkspaceResponse response = new CreateWorkspaceUseCase(
                workspaceRepository, membershipRepository, transactions)
                .execute(new CreateWorkspaceCommand(ACTOR, null));

        assertEquals("My workspace 5", response.name());
        assertEquals(2, transactions.requiresNewInvocations);
    }

    @Test
    void generatedNameDoesNotTranslateUnrelatedMembershipIntegrityFailureOrRetry() {
        WorkspaceRepository workspaceRepository = mock(WorkspaceRepository.class);
        MembershipRepository membershipRepository = mock(MembershipRepository.class);
        when(workspaceRepository.findMaxDefaultWorkspaceNumberByOwner(ACTOR)).thenReturn(2);
        when(workspaceRepository.existsOwnedNameNormalized(ACTOR, "my workspace 3", null)).thenReturn(false);
        when(workspaceRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(membershipRepository.save(any()))
                .thenThrow(new DataIntegrityViolationException("membership constraint"));
        RecordingTransactionRunner transactions = new RecordingTransactionRunner();

        assertThrows(DataIntegrityViolationException.class, () -> new CreateWorkspaceUseCase(
                workspaceRepository, membershipRepository, transactions)
                .execute(new CreateWorkspaceCommand(ACTOR, null)));

        assertEquals(1, transactions.requiresNewInvocations);
    }

    @Test
    void generatedNameFailsExplicitlyWhenNumberingIsExhausted() {
        WorkspaceRepository workspaceRepository = mock(WorkspaceRepository.class);
        MembershipRepository membershipRepository = mock(MembershipRepository.class);
        when(workspaceRepository.findMaxDefaultWorkspaceNumberByOwner(ACTOR)).thenReturn(Integer.MAX_VALUE);

        InvalidStateException exception = assertThrows(InvalidStateException.class, () -> new CreateWorkspaceUseCase(
                workspaceRepository, membershipRepository, new RecordingTransactionRunner())
                .execute(new CreateWorkspaceCommand(ACTOR, null)));

        assertTrue(exception.getMessage().contains("exhausted"));
        verify(workspaceRepository, never()).save(any());
    }

    @Test
    void listMapsRepositoryPageAndKeepsRepositorySemantics() {
        WorkspaceRepository workspaceRepository = mock(WorkspaceRepository.class);
        Workspace workspace = workspace("List me", ACTOR);
        when(workspaceRepository.findAccessibleWorkspaces(ACTOR, new WorkspaceListQuery(
                "list", MembershipRole.MEMBER, 1, 2, WorkspaceSort.UPDATED_AT, SortDirection.DESC)))
                .thenReturn(new PageResult<>(
                        List.of(new WorkspaceMembershipView(workspace, MembershipRole.MEMBER)),
                        1, 2, 3, 2));

        PageResult<WorkspaceResponse> page = new ListWorkspacesUseCase(
                workspaceRepository, new RecordingTransactionRunner())
                .execute(ACTOR, new WorkspaceListQuery(
                        "list", MembershipRole.MEMBER, 1, 2, WorkspaceSort.UPDATED_AT, SortDirection.DESC));

        assertEquals(1, page.items().size());
        assertEquals("List me", page.items().getFirst().name());
        assertEquals(1, page.page());
        assertEquals(2, page.size());
        assertEquals(3, page.totalElements());
        assertEquals(2, page.totalPages());
    }

    @Test
    void getAllowsOwnerAndMemberButHidesNonMember() {
        WorkspaceRepository workspaceRepository = mock(WorkspaceRepository.class);
        MembershipRepository membershipRepository = mock(MembershipRepository.class);
        Workspace workspace = workspace("Visible", ACTOR);
        when(workspaceRepository.findById(WORKSPACE_ID)).thenReturn(Optional.of(workspace));
        when(membershipRepository.findByWorkspaceIdAndUserId(WORKSPACE_ID, ACTOR))
                .thenReturn(Optional.of(Membership.owner(WORKSPACE_ID, ACTOR)));

        WorkspaceResponse owner = new GetWorkspaceUseCase(
                workspaceRepository, membershipRepository, new RecordingTransactionRunner())
                .execute(ACTOR, WORKSPACE_ID);
        assertEquals("Visible", owner.name());

        when(membershipRepository.findByWorkspaceIdAndUserId(WORKSPACE_ID, OTHER_ACTOR))
                .thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class, () -> new GetWorkspaceUseCase(
                workspaceRepository, membershipRepository, new RecordingTransactionRunner())
                .execute(OTHER_ACTOR, WORKSPACE_ID));
    }

    @Test
    void renameRequiresOwnerAndAllowsCasingOnlyChange() {
        WorkspaceRepository workspaceRepository = mock(WorkspaceRepository.class);
        MembershipRepository membershipRepository = mock(MembershipRepository.class);
        Workspace workspace = workspace("Acme", ACTOR);
        when(membershipRepository.findByWorkspaceIdAndUserId(WORKSPACE_ID, ACTOR))
                .thenReturn(Optional.of(Membership.owner(WORKSPACE_ID, ACTOR)));
        when(workspaceRepository.findById(WORKSPACE_ID)).thenReturn(Optional.of(workspace));
        when(workspaceRepository.existsOwnedNameNormalized(ACTOR, "acme", WORKSPACE_ID)).thenReturn(false);
        when(workspaceRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        WorkspaceResponse response = new RenameWorkspaceUseCase(
                workspaceRepository, membershipRepository, new RecordingTransactionRunner())
                .execute(ACTOR, WORKSPACE_ID, "  ACME  ");

        assertEquals("ACME", response.name());
        assertEquals("ACME", response.name());
    }

    @Test
    void renameForbidsMemberAndRejectsDuplicateOwnedName() {
        WorkspaceRepository workspaceRepository = mock(WorkspaceRepository.class);
        MembershipRepository membershipRepository = mock(MembershipRepository.class);
        when(membershipRepository.findByWorkspaceIdAndUserId(WORKSPACE_ID, ACTOR))
                .thenReturn(Optional.of(Membership.member(WORKSPACE_ID, ACTOR)));

        assertThrows(ForbiddenException.class, () -> new RenameWorkspaceUseCase(
                workspaceRepository, membershipRepository, new RecordingTransactionRunner())
                .execute(ACTOR, WORKSPACE_ID, "New name"));

        when(membershipRepository.findByWorkspaceIdAndUserId(WORKSPACE_ID, ACTOR))
                .thenReturn(Optional.of(Membership.owner(WORKSPACE_ID, ACTOR)));
        when(workspaceRepository.findById(WORKSPACE_ID)).thenReturn(Optional.of(workspace("Old", ACTOR)));
        when(workspaceRepository.existsOwnedNameNormalized(ACTOR, "new", WORKSPACE_ID)).thenReturn(true);

        ConflictException exception = assertThrows(ConflictException.class, () -> new RenameWorkspaceUseCase(
                workspaceRepository, membershipRepository, new RecordingTransactionRunner())
                .execute(ACTOR, WORKSPACE_ID, "New"));
        assertEquals("WORKSPACE_NAME_ALREADY_EXISTS", exception.getCode());
    }

    private static Workspace workspace(String name, UUID ownerId) {
        return new Workspace(WORKSPACE_ID, name, ownerId, CREATED_AT, CREATED_AT);
    }

    private static final class RecordingTransactionRunner implements TransactionRunner {
        private int invocations;
        private int requiresNewInvocations;

        @Override
        public <T> T required(Supplier<T> work) {
            invocations++;
            return work.get();
        }

        @Override
        public <T> T requiresNew(Supplier<T> work) {
            requiresNewInvocations++;
            return work.get();
        }
    }
}
