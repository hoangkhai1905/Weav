package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.AddMemberCommand;
import com.weav.workspace.application.dto.MemberView;
import com.weav.workspace.application.dto.UpdateMemberPermissionsCommand;
import com.weav.workspace.application.port.out.AfterCommitExecutor;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.exception.ConflictException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.exception.DomainException;
import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.IdentityUserSummary;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.model.WorkspaceAccessSnapshot;
import com.weav.workspace.domain.port.out.IdentityDirectoryPort;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceAuthorizationCache;
import com.weav.workspace.domain.policy.WorkspaceAuthorizationPolicy;
import com.weav.workspace.domain.query.MemberListQuery;
import com.weav.workspace.domain.query.MemberSort;
import com.weav.workspace.domain.query.SortDirection;
import com.weav.workspace.domain.valueobject.MembershipRole;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MembershipUseCasesTest {

    private static final UUID WORKSPACE = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID OWNER = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID MEMBER = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID OTHER = UUID.fromString("00000000-0000-0000-0000-000000000003");
    private static final Instant JOINED = Instant.parse("2026-01-02T03:04:05Z");

    @Test
    void ownerAddsActiveIdentityUserWithBothOptionalPermissionsDisabled() {
        MembershipRepository memberships = mock(MembershipRepository.class);
        IdentityDirectoryPort identity = mock(IdentityDirectoryPort.class);
        WorkspaceAuthorizationCache cache = mock(WorkspaceAuthorizationCache.class);
        AfterCommitExecutor afterCommit = new ImmediateAfterCommitExecutor();
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OWNER))
                .thenReturn(Optional.of(Membership.owner(WORKSPACE, OWNER)));
        when(memberships.existsByWorkspaceIdAndUserId(WORKSPACE, OTHER)).thenReturn(false);
        when(identity.findByEmail("person@example.com")).thenReturn(Optional.of(
                summary(OTHER, "person@example.com", "Person", true)));
        when(memberships.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        MemberView result = new AddMemberUseCase(
                memberships, identity, new RecordingTransactionRunner(), afterCommit, cache)
                .execute(new AddMemberCommand(WORKSPACE, OWNER, "  person@example.com  "));

        assertEquals(OTHER, result.userId());
        assertEquals(MembershipRole.MEMBER, result.role());
        assertFalse(result.canPublishWorkflow());
        assertFalse(result.canManageWorkflowState());
        verify(cache).evict(WORKSPACE, OTHER);
    }

    @Test
    void addMapsIdentityOutcomesAndRejectsNonOwnerBeforeCallingIdentity() {
        MembershipRepository memberships = mock(MembershipRepository.class);
        IdentityDirectoryPort identity = mock(IdentityDirectoryPort.class);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, MEMBER))
                .thenReturn(Optional.of(Membership.member(WORKSPACE, MEMBER)));

        assertThrows(ForbiddenException.class, () -> new AddMemberUseCase(
                memberships, identity, new RecordingTransactionRunner(),
                new ImmediateAfterCommitExecutor(), mock(WorkspaceAuthorizationCache.class))
                .execute(new AddMemberCommand(WORKSPACE, MEMBER, "person@example.com")));
        verify(identity, never()).findByEmail(any());

        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OWNER))
                .thenReturn(Optional.of(Membership.owner(WORKSPACE, OWNER)));
        when(memberships.existsByWorkspaceIdAndUserId(WORKSPACE, OTHER)).thenReturn(false);
        when(identity.findByEmail("missing@example.com")).thenReturn(Optional.empty());
        DomainException missing = assertThrows(DomainException.class, () -> new AddMemberUseCase(
                memberships, identity, new RecordingTransactionRunner(),
                new ImmediateAfterCommitExecutor(), mock(WorkspaceAuthorizationCache.class))
                .execute(new AddMemberCommand(WORKSPACE, OWNER, "missing@example.com")));
        assertEquals("USER_NOT_FOUND", missing.getCode());

        when(identity.findByEmail("inactive@example.com")).thenReturn(Optional.of(
                summary(OTHER, "inactive@example.com", null, false)));
        DomainException inactive = assertThrows(DomainException.class, () -> new AddMemberUseCase(
                memberships, identity, new RecordingTransactionRunner(),
                new ImmediateAfterCommitExecutor(), mock(WorkspaceAuthorizationCache.class))
                .execute(new AddMemberCommand(WORKSPACE, OWNER, "inactive@example.com")));
        assertEquals("USER_INACTIVE", inactive.getCode());
    }

    @Test
    void addRejectsExistingMembershipAndPreservesIdentityDependencyFailure() {
        MembershipRepository memberships = mock(MembershipRepository.class);
        IdentityDirectoryPort identity = mock(IdentityDirectoryPort.class);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OWNER))
                .thenReturn(Optional.of(Membership.owner(WORKSPACE, OWNER)));
        when(memberships.existsByWorkspaceIdAndUserId(WORKSPACE, OTHER)).thenReturn(true);
        when(identity.findByEmail("person@example.com")).thenReturn(Optional.of(
                summary(OTHER, "person@example.com", "Person", true)));

        ConflictException duplicate = assertThrows(ConflictException.class, () -> new AddMemberUseCase(
                memberships, identity, new RecordingTransactionRunner(),
                new ImmediateAfterCommitExecutor(), mock(WorkspaceAuthorizationCache.class))
                .execute(new AddMemberCommand(WORKSPACE, OWNER, "person@example.com")));
        assertEquals("USER_ALREADY_MEMBER", duplicate.getCode());

        when(memberships.existsByWorkspaceIdAndUserId(WORKSPACE, OTHER)).thenReturn(false);
        when(identity.findByEmail("person@example.com"))
                .thenThrow(new DependencyUnavailableException());
        assertThrows(DependencyUnavailableException.class, () -> new AddMemberUseCase(
                memberships, identity, new RecordingTransactionRunner(),
                new ImmediateAfterCommitExecutor(), mock(WorkspaceAuthorizationCache.class))
                .execute(new AddMemberCommand(WORKSPACE, OWNER, "person@example.com")));
    }

    @Test
    void listUsesIdentityOwnedDisplayNamePathAndKeepsIdentityPageMetadata() {
        MembershipRepository memberships = mock(MembershipRepository.class);
        IdentityDirectoryPort identity = mock(IdentityDirectoryPort.class);
        Membership owner = Membership.owner(WORKSPACE, OWNER);
        Membership member = Membership.member(WORKSPACE, MEMBER, true, false);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, MEMBER)).thenReturn(Optional.of(member));
        when(memberships.findCandidates(WORKSPACE, displayNameQuery())).thenReturn(List.of(owner, member));
        when(identity.searchUsersByDisplayName(
                List.of(OWNER, MEMBER), null, 1, 1, SortDirection.DESC))
                .thenReturn(new PageResult<>(
                        List.of(summary(MEMBER, "member@example.com", null, true)), 1, 1, 3, 3));

        PageResult<MemberView> result = new ListMembersUseCase(
                memberships, identity, new RecordingTransactionRunner())
                .execute(MEMBER, WORKSPACE, displayNameQuery());

        assertEquals(1, result.items().size());
        assertEquals(MEMBER, result.items().getFirst().userId());
        assertEquals(3, result.totalElements());
        assertEquals(3, result.totalPages());
        verify(memberships, never()).pageCandidatesByWorkspaceOwnedSort(any(), any(), anyCollection());
    }

    @Test
    void listUsesWorkspaceOwnedPagingThenEnrichesOnlyThePage() {
        MembershipRepository memberships = mock(MembershipRepository.class);
        IdentityDirectoryPort identity = mock(IdentityDirectoryPort.class);
        Membership owner = Membership.owner(WORKSPACE, OWNER);
        Membership member = Membership.member(WORKSPACE, MEMBER);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OWNER)).thenReturn(Optional.of(owner));
        MemberListQuery query = new MemberListQuery(
                "target", null, null, null, 0, 1, MemberSort.JOINED_AT, SortDirection.ASC);
        when(memberships.findCandidates(WORKSPACE, query)).thenReturn(List.of(owner, member));
        when(identity.matchUserIds(List.of(OWNER, MEMBER), "target")).thenReturn(Set.of(MEMBER));
        when(memberships.pageCandidatesByWorkspaceOwnedSort(WORKSPACE, query, Set.of(MEMBER)))
                .thenReturn(new PageResult<>(List.of(member), 0, 1, 1, 1));
        when(identity.getUsersByIds(List.of(MEMBER))).thenReturn(List.of(
                summary(MEMBER, "member@example.com", "Target", true)));

        PageResult<MemberView> result = new ListMembersUseCase(
                memberships, identity, new RecordingTransactionRunner())
                .execute(OWNER, WORKSPACE, query);

        assertEquals(List.of(MEMBER), result.items().stream().map(MemberView::userId).toList());
        assertEquals(1, result.totalElements());
        verify(identity).getUsersByIds(List.of(MEMBER));
    }

    @Test
    void listHidesWorkspaceFromOutsider() {
        MembershipRepository memberships = mock(MembershipRepository.class);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OTHER)).thenReturn(Optional.empty());

        assertThrows(ResourceNotFoundException.class, () -> new ListMembersUseCase(
                memberships, mock(IdentityDirectoryPort.class), new RecordingTransactionRunner())
                .execute(OTHER, WORKSPACE, displayNameQuery()));
    }

    @Test
    void ownerUpdatesMemberPermissionsAndEvictsAfterCommit() {
        MembershipRepository memberships = mock(MembershipRepository.class);
        WorkspaceAuthorizationCache cache = mock(WorkspaceAuthorizationCache.class);
        Membership owner = Membership.owner(WORKSPACE, OWNER);
        Membership member = Membership.member(WORKSPACE, MEMBER);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OWNER)).thenReturn(Optional.of(owner));
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, MEMBER)).thenReturn(Optional.of(member));
        when(memberships.updateOptionalPermissions(any()))
                .thenAnswer(invocation -> invocation.getArgument(0));

        Membership result = new UpdateMemberPermissionsUseCase(
                memberships, new RecordingTransactionRunner(),
                new ImmediateAfterCommitExecutor(), cache)
                .execute(new UpdateMemberPermissionsCommand(WORKSPACE, OWNER, MEMBER, true, true));

        assertTrue(result.isCanPublishWorkflow());
        assertTrue(result.isCanManageWorkflowState());
        verify(cache).evict(WORKSPACE, MEMBER);
    }

    @Test
    void removeAndLeaveProtectOwnerAndOnlyDeleteTargetMembership() {
        MembershipRepository memberships = mock(MembershipRepository.class);
        WorkspaceAuthorizationCache cache = mock(WorkspaceAuthorizationCache.class);
        Membership owner = Membership.owner(WORKSPACE, OWNER);
        Membership member = Membership.member(WORKSPACE, MEMBER);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OWNER)).thenReturn(Optional.of(owner));
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, MEMBER)).thenReturn(Optional.of(member));

        new RemoveMemberUseCase(memberships, new RecordingTransactionRunner(),
                new ImmediateAfterCommitExecutor(), cache).execute(WORKSPACE, OWNER, MEMBER);
        verify(memberships).delete(member);
        verify(cache).evict(WORKSPACE, MEMBER);

        assertEquals("OWNER_CANNOT_LEAVE", assertThrows(ConflictException.class, () ->
                new LeaveWorkspaceUseCase(memberships, new RecordingTransactionRunner(),
                        new ImmediateAfterCommitExecutor(), cache).execute(WORKSPACE, OWNER)).getCode());
        assertEquals("OWNER_CANNOT_REMOVE", assertThrows(ConflictException.class, () ->
                new RemoveMemberUseCase(memberships, new RecordingTransactionRunner(),
                        new ImmediateAfterCommitExecutor(), cache).execute(WORKSPACE, OWNER, OWNER)).getCode());
    }

    @Test
    void accessResolverHitsCacheWithoutRepositoryAndFallsBackOnCacheFailure() {
        MembershipRepository memberships = mock(MembershipRepository.class);
        WorkspaceAuthorizationCache cache = mock(WorkspaceAuthorizationCache.class);
        WorkspaceAccessSnapshot snapshot = new WorkspaceAccessSnapshot(
                WORKSPACE, MEMBER, MembershipRole.MEMBER,
                new WorkspaceAuthorizationPolicy().resolve(Membership.member(WORKSPACE, MEMBER)));
        when(cache.get(WORKSPACE, MEMBER)).thenReturn(Optional.of(snapshot));

        WorkspaceAccessSnapshot hit = new ResolveWorkspaceAccessUseCase(
                memberships, new WorkspaceAuthorizationPolicy(), cache,
                new RecordingTransactionRunner(),
                new ImmediateAfterCommitExecutor(),
                Duration.ofMinutes(5))
                .execute(WORKSPACE, MEMBER);
        assertEquals(snapshot, hit);
        verify(memberships, never()).findByWorkspaceIdAndUserId(any(), any());

        when(cache.get(WORKSPACE, MEMBER)).thenThrow(new IllegalStateException("cache down"));
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, MEMBER)).thenReturn(Optional.of(
                Membership.member(WORKSPACE, MEMBER)));
        WorkspaceAccessSnapshot fallback = new ResolveWorkspaceAccessUseCase(
                memberships, new WorkspaceAuthorizationPolicy(), cache,
                new RecordingTransactionRunner(),
                new ImmediateAfterCommitExecutor(),
                Duration.ofMinutes(5))
                .execute(WORKSPACE, MEMBER);
        assertEquals(MEMBER, fallback.userId());
    }

    private static MemberListQuery displayNameQuery() {
        return new MemberListQuery(null, null, null, null, 1, 1,
                MemberSort.DISPLAY_NAME, SortDirection.DESC);
    }

    private static IdentityUserSummary summary(
            UUID id, String email, String displayName, boolean active) {
        return new IdentityUserSummary(id, email, displayName, active);
    }

    private static final class RecordingTransactionRunner implements TransactionRunner {
        @Override
        public <T> T required(Supplier<T> work) {
            return work.get();
        }

        @Override
        public <T> T requiresNew(Supplier<T> work) {
            return work.get();
        }
    }

    private static final class ImmediateAfterCommitExecutor implements AfterCommitExecutor {
        @Override
        public void execute(Runnable action) {
            action.run();
        }
    }
}
