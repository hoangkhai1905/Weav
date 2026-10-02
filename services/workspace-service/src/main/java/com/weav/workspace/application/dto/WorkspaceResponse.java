package com.weav.workspace.application.dto;

import com.weav.workspace.domain.model.Workspace;

import java.time.Instant;
import java.util.UUID;

public record WorkspaceResponse(
        UUID id,
        String name,
        UUID createdBy,
        Instant createdAt,
        Instant updatedAt) {

    public static WorkspaceResponse from(Workspace workspace) {
        return new WorkspaceResponse(
                workspace.getId(),
                workspace.getName(),
                workspace.getCreatedBy(),
                workspace.getCreatedAt(),
                workspace.getUpdatedAt());
    }
}
