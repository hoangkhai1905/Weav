package com.weav.workspace.presentation.http.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateWorkspaceRequest(
        @NotBlank(message = "Workspace name is required")
        @Size(max = 255, message = "Workspace name must not exceed 255 characters")
        String name
) {
}