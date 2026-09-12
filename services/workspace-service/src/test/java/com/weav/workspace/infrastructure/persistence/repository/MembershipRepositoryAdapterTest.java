package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.domain.query.MemberListQuery;
import com.weav.workspace.domain.query.MemberSort;
import com.weav.workspace.domain.query.SortDirection;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verifyNoInteractions;

@ExtendWith(MockitoExtension.class)
class MembershipRepositoryAdapterTest {

    @Mock
    private SpringDataMembershipRepository repository;

    @Test
    void rejectsIdentityOwnedDisplayNameSortForWorkspaceOwnedPaging() {
        MembershipRepositoryAdapter adapter = new MembershipRepositoryAdapter(repository);
        MemberListQuery query = displayNameQuery();

        assertThatThrownBy(() -> adapter.pageCandidatesByWorkspaceOwnedSort(
                        UUID.randomUUID(), query, Set.of(UUID.randomUUID())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("DISPLAY_NAME");

        verifyNoInteractions(repository);
    }

    @Test
    void rejectsDisplayNameSortBeforeEmptyMatchedIdsShortcut() {
        MembershipRepositoryAdapter adapter = new MembershipRepositoryAdapter(repository);

        assertThatThrownBy(() -> adapter.pageCandidatesByWorkspaceOwnedSort(
                        UUID.randomUUID(), displayNameQuery(), List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("DISPLAY_NAME");

        verifyNoInteractions(repository);
    }

    private MemberListQuery displayNameQuery() {
        return new MemberListQuery(
                null,
                null,
                null,
                null,
                0,
                20,
                MemberSort.DISPLAY_NAME,
                SortDirection.ASC);
    }
}
