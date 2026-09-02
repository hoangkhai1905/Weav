package com.weav.workflow.workflow.api.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import tools.jackson.databind.JsonNode;

public record CreateWorkflowRequest(
        @NotBlank(message = "Workflow name is required")
        @Size(max = 255, message = "Workflow name must not exceed 255 characters")
        String name,
        String description,
        @NotBlank(message = "Schema version is required")
        @Size(max = 32, message = "Schema version must not exceed 32 characters")
        String schemaVersion,
        @NotNull(message = "Draft definition is required")
        JsonNode draftDefinition,
        JsonNode editorState
) {
}