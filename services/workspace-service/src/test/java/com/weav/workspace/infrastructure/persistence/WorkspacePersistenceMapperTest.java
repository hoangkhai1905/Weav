package com.weav.workspace.infrastructure.persistence;

import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.valueobject.MembershipRole;
import com.weav.workspace.infrastructure.persistence.entity.MembershipJpaEntity;
import com.weav.workspace.infrastructure.persistence.entity.WorkspaceJpaEntity;
import com.weav.workspace.infrastructure.persistence.mapper.WorkspacePersistenceMapper;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class WorkspacePersistenceMapperTest {

    private static final Instant CREATED_AT = Instant.parse("2026-01-01T00:00:00Z");
    private static final Instant UPDATED_AT = Instant.parse("2026-01-02T00:00:00Z");

    @Test
    void workspaceRoundTripPreservesIdentityNamesAndTimestamps() {
        UUID id = UUID.randomUUID();
        UUID ownerId = UUID.randomUUID();
        Workspace source = new Workspace(id, "Project A", ownerId, CREATED_AT, UPDATED_AT);
        WorkspacePersistenceMapper mapper = new WorkspacePersistenceMapper();

        WorkspaceJpaEntity entity = mapper.toEntity(source);
        Workspace restored = mapper.toDomain(entity);

        assertThat(restored.getId()).isEqualTo(id);
        assertThat(restored.getName()).isEqualTo("Project A");
        assertThat(restored.getNameNormalized()).isEqualTo("project a");
        assertThat(restored.getCreatedBy()).isEqualTo(ownerId);
        assertThat(restored.getCreatedAt()).isEqualTo(CREATED_AT);
        assertThat(restored.getUpdatedAt()).isEqualTo(UPDATED_AT);
    }

    @Test
    void membershipRoundTripPreservesIdentityPermissionsRoleAndTimestamps() {
        UUID id = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        Membership source = new Membership(
                id, workspaceId, userId, MembershipRole.MEMBER, true, false, CREATED_AT, UPDATED_AT);
        WorkspacePersistenceMapper mapper = new WorkspacePersistenceMapper();

        MembershipJpaEntity entity = mapper.toEntity(source);
        Membership restored = mapper.toDomain(entity);

        assertThat(restored.getId()).isEqualTo(id);
        assertThat(restored.getWorkspaceId()).isEqualTo(workspaceId);
        assertThat(restored.getUserId()).isEqualTo(userId);
        assertThat(restored.getRole()).isEqualTo(MembershipRole.MEMBER);
        assertThat(restored.isCanPublishWorkflow()).isTrue();
        assertThat(restored.isCanManageWorkflowState()).isFalse();
        assertThat(restored.getJoinedAt()).isEqualTo(CREATED_AT);
        assertThat(restored.getUpdatedAt()).isEqualTo(UPDATED_AT);
    }
}
