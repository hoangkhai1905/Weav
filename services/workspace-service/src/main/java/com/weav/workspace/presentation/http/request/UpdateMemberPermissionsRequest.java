package com.weav.workspace.presentation.http.request;

import jakarta.validation.constraints.NotNull;

public record UpdateMemberPermissionsRequest(
        @NotNull(message = "canPublishWorkflow is required")
        Boolean canPublishWorkflow,
        @NotNull(message = "canManageWorkflowState is required")
        Boolean canManageWorkflowState) {
}
