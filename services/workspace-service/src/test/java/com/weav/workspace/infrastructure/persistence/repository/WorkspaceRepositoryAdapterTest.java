package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.model.WorkspaceMembershipView;
import com.weav.workspace.domain.query.WorkspaceListQuery;
import com.weav.workspace.domain.valueobject.MembershipRole;
import com.weav.workspace.infrastructure.persistence.entity.WorkspaceJpaEntity;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WorkspaceRepositoryAdapterTest {

    @Mock
    private SpringDataWorkspaceRepository repository;

    @Test
    void accessibleWorkspaceListingMapsJoinedRoleWithoutMembershipRereads() {
        UUID workspaceId = UUID.randomUUID();
        UUID ownerId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        WorkspaceJpaEntity workspace = new WorkspaceJpaEntity(
                workspaceId,
                "Project A",
                "project a",
                ownerId,
                Instant.parse("2026-01-01T00:00:00Z"),
                Instant.parse("2026-01-02T00:00:00Z"));
        WorkspaceMembershipProjection row = mock(WorkspaceMembershipProjection.class);
        when(row.getWorkspace()).thenReturn(workspace);
        when(row.getRole()).thenReturn(MembershipRole.MEMBER);
        when(repository.findAccessibleWorkspaces(
                        eq(userId),
                        eq(MembershipRole.MEMBER),
                        eq("%project a%"),
                        any(PageRequest.class)))
                .thenReturn(new PageImpl<>(List.of(row), PageRequest.of(0, 20), 1));

        WorkspaceRepositoryAdapter adapter = new WorkspaceRepositoryAdapter(repository);

        PageResult<WorkspaceMembershipView> result = adapter.findAccessibleWorkspaces(
                userId,
                new WorkspaceListQuery(
                        "Project A",
                        MembershipRole.MEMBER,
                        0,
                        20,
                        com.weav.workspace.domain.query.WorkspaceSort.NAME,
                        com.weav.workspace.domain.query.SortDirection.ASC));

        assertThat(result.items()).hasSize(1);
        assertThat(result.items().getFirst().workspace().getId()).isEqualTo(workspaceId);
        assertThat(result.items().getFirst().role()).isEqualTo(MembershipRole.MEMBER);
        ArgumentCaptor<PageRequest> pageRequest = ArgumentCaptor.forClass(PageRequest.class);
        verify(repository).findAccessibleWorkspaces(
                eq(userId),
                eq(MembershipRole.MEMBER),
                eq("%project a%"),
                pageRequest.capture());
        assertThat(pageRequest.getValue().getSort().getOrderFor("nameNormalized").getDirection())
                .isEqualTo(org.springframework.data.domain.Sort.Direction.ASC);
        assertThat(pageRequest.getValue().getSort().getOrderFor("id").getDirection())
                .isEqualTo(org.springframework.data.domain.Sort.Direction.ASC);
    }
}
