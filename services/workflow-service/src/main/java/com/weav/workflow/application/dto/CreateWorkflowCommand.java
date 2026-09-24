package com.weav.workflow.application.dto;

import java.util.UUID;

public record CreateWorkflowCommand(UUID workspaceId, UUID actorId, String name, String description) {
}
