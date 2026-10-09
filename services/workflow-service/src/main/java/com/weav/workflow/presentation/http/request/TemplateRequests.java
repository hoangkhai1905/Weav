package com.weav.workflow.presentation.http.request;

import com.weav.workflow.domain.valueobject.TemplateVisibility;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/** Bodies of the template routes. Length limits mirror the V14 columns; the service re-checks after trimming. */
public final class TemplateRequests {
    private TemplateRequests() {
    }

    /** PUT /workspaces/{ws}/workflows/{wf}/template */
    public record ShareTemplateRequest(
            @NotBlank(message = "Template name is required")
            @Size(max = 255, message = "Template name must not exceed 255 characters")
            String name,
            @Size(max = 2000, message = "Description must not exceed 2000 characters")
            String description,
            @Size(max = 120, message = "Author name must not exceed 120 characters")
            String authorName,
            @NotNull(message = "Visibility is required")
            TemplateVisibility visibility) {
    }

    /** PATCH /templates/{id}; absent fields stay unchanged. */
    public record PatchTemplateRequest(
            @Size(min = 1, max = 255, message = "Template name must be 1 to 255 characters")
            String name,
            @Size(max = 2000, message = "Description must not exceed 2000 characters")
            String description,
            TemplateVisibility visibility) {
    }

    /** POST /templates/{id}/use */
    public record UseTemplateRequest(
            @NotNull(message = "workspaceId is required")
            UUID workspaceId,
            @Size(max = 255, message = "Workflow name must not exceed 255 characters")
            String name) {
    }
}
