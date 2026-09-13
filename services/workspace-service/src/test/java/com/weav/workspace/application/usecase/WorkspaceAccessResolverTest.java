package com.weav.workspace.application.usecase;

import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.WorkspaceAccessSnapshot;
import com.weav.workspace.domain.model.WorkspaceCapability;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceAuthorizationCache;
import com.weav.workspace.domain.policy.WorkspaceAuthorizationPolicy;
import com.weav.workspace.domain.valueobject.MembershipRole;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WorkspaceAccessResolverTest {

    private static final UUID WORKSPACE = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID USER = UUID.fromString("00000000-0000-0000-0000-000000000002");

    @Test
    void cacheWriteFailureStillReturnsAuthoritativeDatabaseAnswer() {
        MembershipRepository memberships = mock(MembershipRepository.class);
        WorkspaceAuthorizationCache cache = mock(WorkspaceAuthorizationCache.class);
        Membership membership = Membership.member(WORKSPACE, USER, true, false);
        when(cache.get(WORKSPACE, USER)).thenReturn(Optional.empty());
        when(cache.readGeneration(WORKSPACE, USER, Duration.ofMinutes(5)))
                .thenReturn(Optional.of("generation-1"));
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, USER)).thenReturn(Optional.of(membership));
        org.mockito.Mockito.doThrow(new IllegalStateException("cache unavailable"))
                .when(cache).putIfGenerationMatches(
                        org.mockito.ArgumentMatchers.any(),
                        org.mockito.ArgumentMatchers.any(),
                        org.mockito.ArgumentMatchers.anyString());

        WorkspaceAccessSnapshot snapshot = resolver(memberships, cache).execute(WORKSPACE, USER);

        assertThat(snapshot.capabilities()).contains(WorkspaceCapability.WORKFLOW_PUBLISH);
        verify(memberships).findByWorkspaceIdAndUserId(WORKSPACE, USER);
    }

    @Test
    void mismatchedOrInvalidCachedSnapshotCannotGrantAccess() {
        MembershipRepository memberships = mock(MembershipRepository.class);
        WorkspaceAuthorizationCache cache = mock(WorkspaceAuthorizationCache.class);
        Membership membership = Membership.member(WORKSPACE, USER);
        WorkspaceAccessSnapshot mismatched = new WorkspaceAccessSnapshot(
                WORKSPACE,
                UUID.randomUUID(),
                MembershipRole.OWNER,
                java.util.Set.of(WorkspaceCapability.WORKSPACE_VIEW));
        when(cache.get(WORKSPACE, USER)).thenReturn(Optional.of(mismatched));
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, USER)).thenReturn(Optional.of(membership));

        WorkspaceAccessSnapshot snapshot = resolver(memberships, cache).execute(WORKSPACE, USER);

        assertThat(snapshot.userId()).isEqualTo(USER);
        assertThat(snapshot.role()).isEqualTo(MembershipRole.MEMBER);
        verify(memberships).findByWorkspaceIdAndUserId(WORKSPACE, USER);
    }

    @Test
    void missingAuthoritativeMembershipDeniesAccess() {
        MembershipRepository memberships = mock(MembershipRepository.class);
        WorkspaceAuthorizationCache cache = mock(WorkspaceAuthorizationCache.class);
        when(cache.get(WORKSPACE, USER)).thenReturn(Optional.empty());
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, USER)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> resolver(memberships, cache).execute(WORKSPACE, USER))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    private ResolveWorkspaceAccessUseCase resolver(
            MembershipRepository memberships,
            WorkspaceAuthorizationCache cache) {
        TransactionRunner transactions = new TransactionRunner() {
            @Override
            public <T> T required(Supplier<T> work) {
                return work.get();
            }

            @Override
            public <T> T requiresNew(Supplier<T> work) {
                return work.get();
            }
        };
        return new ResolveWorkspaceAccessUseCase(
                memberships,
                new WorkspaceAuthorizationPolicy(),
                cache,
                transactions,
                action -> action.run(),
                Duration.ofMinutes(5));
    }
}
