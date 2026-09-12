package com.weav.workspace.domain;

import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.WorkspaceCapability;
import com.weav.workspace.domain.policy.WorkspaceAuthorizationPolicy;
import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class WorkspaceAuthorizationPolicyTest {

    private final WorkspaceAuthorizationPolicy policy = new WorkspaceAuthorizationPolicy();
    private final UUID workspaceId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();

    @Test
    void ownerReceivesEveryV1Capability() {
        Set<WorkspaceCapability> capabilities = policy.resolve(
                Membership.owner(workspaceId, userId));

        assertThat(capabilities).containsExactlyInAnyOrder(WorkspaceCapability.values());
    }

    @Test
    void memberWithoutOptionalPermissionsReceivesBaselineCapabilities() {
        Set<WorkspaceCapability> capabilities = policy.resolve(
                Membership.member(workspaceId, userId, false, false));

        assertThat(capabilities).containsExactlyInAnyOrder(
                WorkspaceCapability.WORKSPACE_VIEW,
                WorkspaceCapability.MEMBER_VIEW,
                WorkspaceCapability.WORKFLOW_CREATE,
                WorkspaceCapability.WORKFLOW_EDIT,
                WorkspaceCapability.WORKFLOW_RUN,
                WorkspaceCapability.WORKFLOW_MONITOR);
    }

    @Test
    void memberWithPublishGrantGetsPublishButNotManageState() {
        Set<WorkspaceCapability> capabilities = policy.resolve(
                Membership.member(workspaceId, userId, true, false));

        assertThat(capabilities).contains(WorkspaceCapability.WORKFLOW_PUBLISH);
        assertThat(capabilities).doesNotContain(WorkspaceCapability.WORKFLOW_MANAGE_STATE);
    }

    @Test
    void memberWithStateGrantGetsManageStateButNotPublish() {
        Set<WorkspaceCapability> capabilities = policy.resolve(
                Membership.member(workspaceId, userId, false, true));

        assertThat(capabilities).contains(WorkspaceCapability.WORKFLOW_MANAGE_STATE);
        assertThat(capabilities).doesNotContain(WorkspaceCapability.WORKFLOW_PUBLISH);
    }
}
