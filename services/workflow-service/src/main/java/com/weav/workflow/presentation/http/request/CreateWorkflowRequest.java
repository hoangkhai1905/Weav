package com.weav.workflow.presentation.http.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateWorkflowRequest(
        @NotBlank(message = "Workflow name is required")
        @Size(max = 255, message = "Workflow name must not exceed 255 characters")
        String name,
        String description
) {
}
