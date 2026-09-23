package com.weav.workflow.presentation.http.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import tools.jackson.databind.JsonNode;

import java.util.Map;

public record SaveWorkflowDraftRequest(
        @NotBlank(message = "Workflow name is required")
        @Size(max = 255, message = "Workflow name must not exceed 255 characters")
        String name,
        String description,
        @NotNull(message = "Workflow definition is required")
        JsonNode definition,
        Map<String, Object> editorState
) {
}
