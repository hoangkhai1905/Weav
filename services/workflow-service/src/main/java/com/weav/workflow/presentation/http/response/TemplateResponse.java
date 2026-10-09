package com.weav.workflow.presentation.http.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.weav.workflow.application.port.out.TemplateStore;
import com.weav.workflow.application.port.out.TemplateStore.Template;
import com.weav.workflow.application.service.TemplateService;
import com.weav.workflow.domain.template.DefinitionMaps;
import com.weav.workflow.domain.template.TemplateSanitizer;
import com.weav.workflow.domain.valueobject.TemplateVisibility;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** HTTP projections of shared templates. The share code and source ids are only sent to the owner. */
public final class TemplateResponse {
    private TemplateResponse() {
    }

    public record Summary(UUID id, String name, String description, String authorName, List<String> nodeTypes,
                          TemplateVisibility visibility, int usageCount, Instant createdAt, Instant updatedAt,
                          boolean owned) {
        static Summary from(Template t, UUID callerId) {
            return new Summary(t.id(), t.name(), t.description(), t.authorName(), t.nodeTypes(), t.visibility(),
                    t.usageCount(), t.createdAt(), t.updatedAt(), t.ownerId().equals(callerId));
        }
    }

    public record Page(List<Summary> items, int page, int size, long totalElements) {
        public static Page from(TemplateStore.Page page, UUID callerId) {
            return new Page(page.items().stream().map(t -> Summary.from(t, callerId)).toList(), page.page(),
                    page.size(), page.totalElements());
        }
    }

    public record Detail(UUID id, String name, String description, String authorName, List<String> nodeTypes,
                         TemplateVisibility visibility, int usageCount, Instant createdAt, Instant updatedAt,
                         boolean owned, Map<String, Object> definition, Map<String, Object> editorState,
                         @JsonInclude(JsonInclude.Include.NON_NULL) String shareCode,
                         @JsonInclude(JsonInclude.Include.NON_NULL) UUID workspaceId,
                         @JsonInclude(JsonInclude.Include.NON_NULL) UUID sourceWorkflowId) {
        public static Detail from(Template t, UUID callerId) {
            boolean owned = t.ownerId().equals(callerId);
            return new Detail(t.id(), t.name(), t.description(), t.authorName(), t.nodeTypes(), t.visibility(),
                    t.usageCount(), t.createdAt(), t.updatedAt(), owned, t.definition(), t.editorState(),
                    owned ? t.shareCode() : null, owned ? t.workspaceId() : null,
                    owned ? t.sourceWorkflowId() : null);
        }
    }

    public record Preview(Map<String, Object> definition, Map<String, Object> editorState,
                          List<TemplateSanitizer.RemovedField> removedFields,
                          List<TemplateSanitizer.TemplateWarning> warnings, Detail existing) {
        public static Preview from(TemplateService.Preview preview, UUID callerId) {
            TemplateSanitizer.SanitizedTemplate s = preview.sanitized();
            return new Preview(DefinitionMaps.toMap(s.definition()), s.editorState(), s.removedFields(),
                    s.warnings(), preview.existing().map(t -> Detail.from(t, callerId)).orElse(null));
        }
    }

    public record Used(UUID workflowId) {
    }
}
