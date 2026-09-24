package com.weav.workflow.presentation.http.response;

import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.valueobject.WorkflowStatus;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record WorkflowResponse(
        UUID workflowId,
        String name,
        String description,
        WorkflowStatus status,
        String schemaVersion,
        Map<String, Object> definition,
        Map<String, Object> editorState,
        UUID currentVersionId,
        Instant createdAt,
        Instant updatedAt,
        Instant publishedAt,
        List<TriggerRegistration> triggers) {

    public WorkflowResponse {
        triggers = List.copyOf(triggers);
    }

    public static WorkflowResponse from(Workflow workflow) {
        return from(workflow, List.of());
    }

    public static WorkflowResponse from(Workflow workflow, List<WorkflowTrigger> registrations) {
        return new WorkflowResponse(workflow.getId(), workflow.getName(), workflow.getDescription(),
                workflow.getStatus(), workflow.getSchemaVersion(), workflow.getDraftDefinition(),
                workflow.getEditorState(), workflow.getCurrentVersionId(), workflow.getCreatedAt(),
                workflow.getUpdatedAt(), workflow.getPublishedAt(), registrations.stream()
                .map(TriggerRegistration::from).toList());
    }

    public record TriggerRegistration(UUID triggerId, String type, String status, String reasonCode,
                                      Instant nextRunAt, Instant lastTriggeredAt) {
        private static TriggerRegistration from(WorkflowTrigger trigger) {
            Map<String, Object> error = trigger.getLastError();
            String storedCode = error != null && error.get("code") instanceof String code ? code : null;
            String safeCode = switch (storedCode == null ? "" : storedCode) {
                case "DEPENDENCY_NOT_CONFIGURED", "SCHEDULE_ADMISSION_FAILED" -> storedCode;
                default -> null;
            };
            return new TriggerRegistration(trigger.getId(), trigger.getType().name(), trigger.getStatus().name(),
                    safeCode, trigger.getNextRunAt(), trigger.getLastTriggeredAt());
        }
    }

    public record Created(UUID workflowId, WorkflowStatus status) {
        public static Created from(Workflow workflow) {
            return new Created(workflow.getId(), workflow.getStatus());
        }
    }

    public record Publication(UUID workflowId, UUID versionId, int version, WorkflowStatus status,
                              List<WebhookProvisioning> webhooks) {
        public Publication {
            webhooks = List.copyOf(webhooks);
        }

        public static Publication from(WorkflowPublicationService.Publication publication) {
            return new Publication(publication.workflowId(), publication.versionId(), publication.version(),
                    publication.status(), publication.webhooks().stream()
                    .map(webhook -> new WebhookProvisioning(webhook.triggerId(), webhook.endpointKey(), webhook.secret()))
                    .toList());
        }
    }

    /** Contains only one-time provisioning data when a future trigger provider is ready. */
    public record WebhookProvisioning(UUID triggerId, String endpointKey, String secret) {
        @Override
        public String toString() {
            return "WebhookProvisioning[triggerId=" + triggerId
                    + ", endpointKey=<redacted>, secret=<redacted>]";
        }
    }

    public record Summary(UUID workflowId, String name, String description, WorkflowStatus status,
                          String schemaVersion, UUID currentVersionId, Instant createdAt,
                          Instant updatedAt, Instant publishedAt) {
        public static Summary from(Workflow workflow) {
            return new Summary(workflow.getId(), workflow.getName(), workflow.getDescription(),
                    workflow.getStatus(), workflow.getSchemaVersion(), workflow.getCurrentVersionId(),
                    workflow.getCreatedAt(), workflow.getUpdatedAt(), workflow.getPublishedAt());
        }
    }

    public record Page(List<Summary> items, int page, int size, long totalElements) {
        public Page {
            items = List.copyOf(items);
        }

        public static Page from(WorkflowDraftService.WorkflowPage page) {
            return new Page(page.items().stream().map(Summary::from).toList(),
                    page.page(), page.size(), page.totalElements());
        }
    }
}
