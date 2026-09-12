package com.weav.workspace.infrastructure.persistence;

import com.weav.workspace.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class WorkspacePersistenceCoreTest {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void migrationBackfillsTrimmedCaseInsensitiveWorkspaceNames() {
        assertThat(jdbcTemplate.queryForObject(
                "select exists (select 1 from information_schema.columns "
                        + "where table_schema = 'workspace' and table_name = 'workspaces' "
                        + "and column_name = 'name_normalized')",
                Boolean.class)).isTrue();
    }

    @Test
    @Transactional
    void ownerScopedNormalizedNameIsUnique() {
        UUID firstOwner = UUID.randomUUID();
        UUID firstWorkspace = UUID.randomUUID();

        insertWorkspace(firstWorkspace, "Project A", firstOwner);

        assertThatThrownBy(() -> insertWorkspace(UUID.randomUUID(), "project a", firstOwner))
                .hasMessageContaining("ux_workspaces_owner_name_normalized");
    }

    @Test
    @Transactional
    void differentOwnersMayReuseNormalizedName() {
        UUID firstOwner = UUID.randomUUID();
        UUID secondOwner = UUID.randomUUID();

        insertWorkspace(UUID.randomUUID(), "Project A", firstOwner);

        insertWorkspace(UUID.randomUUID(), "project a", secondOwner);
    }

    @Test
    @Transactional
    void membershipIdentityRemainsUnique() {
        UUID workspaceId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        insertWorkspace(workspaceId, "Membership Test", UUID.randomUUID());
        insertMembership(UUID.randomUUID(), workspaceId, userId, "MEMBER");

        assertThatThrownBy(() -> insertMembership(UUID.randomUUID(), workspaceId, userId, "MEMBER"))
                .hasMessageContaining("uk_membership_workspace_user");
    }

    private void insertWorkspace(UUID id, String name, UUID ownerId) {
        jdbcTemplate.update(
                "insert into workspace.workspaces "
                        + "(id, name, name_normalized, created_by, created_at, updated_at) "
                        + "values (?, ?, lower(btrim(?)), ?, now(), now())",
                id, name, name, ownerId);
    }

    private void insertMembership(UUID id, UUID workspaceId, UUID userId, String role) {
        jdbcTemplate.update(
                "insert into workspace.memberships "
                        + "(id, workspace_id, user_id, role, joined_at, updated_at) "
                        + "values (?, ?, ?, ?, now(), now())",
                id, workspaceId, userId, role);
    }
}
