package com.weav.workflow.application.port.out;

import com.weav.workflow.domain.valueobject.TemplateVisibility;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Persistence for shared workflow templates (soft-deleted rows are invisible to every method here). */
public interface TemplateStore {

    /** Stores the template under a freshly generated share code (the code on {@code t} is ignored). */
    Template insert(Template t);

    /** Replaces the editable fields (name, description, author, definition, editor state, node types, visibility). */
    Template update(Template t);

    Optional<Template> findLive(UUID id);

    /** {@code code} must already be normalized (see ShareCode.normalize). */
    Optional<Template> findLiveByCode(String code);

    Optional<Template> findLiveBySourceWorkflow(UUID workflowId);

    int countLiveByOwner(UUID ownerId);

    /**
     * PUBLIC: all public rows, most used first. WORKSPACE: PRIVATE rows of {@code workspaceId}.
     * MINE: every row of {@code callerId}. {@code query} matches name or description, case-insensitively.
     */
    Page list(Scope scope, UUID callerId, UUID workspaceId, String query, int page, int size);

    void softDelete(UUID id, Instant at);

    /** False when the template is missing or deleted. */
    boolean incrementUsage(UUID id);

    enum Scope { PUBLIC, WORKSPACE, MINE }

    record Page(List<Template> items, int page, int size, long totalElements) {
        public Page {
            items = List.copyOf(items);
        }
    }

    record Template(UUID id, UUID ownerId, UUID workspaceId, UUID sourceWorkflowId, String name, String description,
                    String authorName, Map<String, Object> definition, Map<String, Object> editorState,
                    List<String> nodeTypes, TemplateVisibility visibility, String shareCode, int usageCount,
                    Instant createdAt, Instant updatedAt) {
    }
}
