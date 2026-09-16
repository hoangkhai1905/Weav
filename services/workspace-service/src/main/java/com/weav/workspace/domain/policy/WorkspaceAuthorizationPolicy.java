package com.weav.workspace.domain.policy;

import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.WorkspaceCapability;
import com.weav.workspace.domain.valueobject.MembershipRole;

import java.util.Collections;
import java.util.EnumSet;
import java.util.Objects;
import java.util.Set;

public class WorkspaceAuthorizationPolicy {

    private static final Set<WorkspaceCapability> MEMBER_BASELINE = Set.of(
            WorkspaceCapability.WORKSPACE_VIEW,
            WorkspaceCapability.MEMBER_VIEW,
            WorkspaceCapability.WORKFLOW_CREATE,
            WorkspaceCapability.WORKFLOW_EDIT,
            WorkspaceCapability.WORKFLOW_RUN,
            WorkspaceCapability.WORKFLOW_MONITOR);

    public Set<WorkspaceCapability> resolve(Membership membership) {
        Objects.requireNonNull(membership, "membership must not be null");
        if (membership.getRole() == MembershipRole.OWNER) {
            return Collections.unmodifiableSet(EnumSet.allOf(WorkspaceCapability.class));
        }

        EnumSet<WorkspaceCapability> capabilities = EnumSet.copyOf(MEMBER_BASELINE);
        if (membership.isCanPublishWorkflow()) {
            capabilities.add(WorkspaceCapability.WORKFLOW_PUBLISH);
        }
        if (membership.isCanManageWorkflowState()) {
            capabilities.add(WorkspaceCapability.WORKFLOW_MANAGE_STATE);
        }
        return Collections.unmodifiableSet(capabilities);
    }
}
