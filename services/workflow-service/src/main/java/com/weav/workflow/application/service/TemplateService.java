package com.weav.workflow.application.service;

import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.port.out.TemplateStore;
import com.weav.workflow.application.port.out.TemplateStore.Template;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.exception.ConflictException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.domain.exception.ResourceNotFoundException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.template.DefinitionMaps;
import com.weav.workflow.domain.template.ShareCode;
import com.weav.workflow.domain.template.TemplateSanitizer;
import com.weav.workflow.domain.template.TemplateSanitizer.SanitizedTemplate;
import com.weav.workflow.domain.valueobject.TemplateVisibility;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionOperations;

import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Shares workflows as sanitized templates and lets people browse and copy them. A hidden template always answers
 * "not found" (never "forbidden") so ids and codes cannot be probed.
 */
@Service
public class TemplateService {
    private static final Logger log = LoggerFactory.getLogger(TemplateService.class);
    static final String EDIT_CAPABILITY = "WORKFLOW_EDIT";
    static final String CREATE_CAPABILITY = "WORKFLOW_CREATE";
    public static final int MAX_TEMPLATES_PER_OWNER = 50;
    public static final int MAX_NAME = 255;
    public static final int MAX_DESCRIPTION = 2000;
    public static final int MAX_AUTHOR = 120;

    private final WorkspaceAuthorization workspaceAuthorization;
    private final WorkflowDraftService drafts;
    private final TemplateStore store;
    private final TransactionOperations transactions;
    private final Clock clock;
    private final TemplateSanitizer sanitizer = new TemplateSanitizer();

    public TemplateService(WorkspaceAuthorization workspaceAuthorization, WorkflowDraftService drafts,
                           TemplateStore store, TransactionOperations transactions,
                           @Qualifier("workflowExecutionClock") Clock clock) {
        this.workspaceAuthorization = Objects.requireNonNull(workspaceAuthorization);
        this.drafts = Objects.requireNonNull(drafts);
        this.store = Objects.requireNonNull(store);
        this.transactions = Objects.requireNonNull(transactions);
        this.clock = Objects.requireNonNull(clock);
    }

    /** What sharing would remove and warn about, plus this workflow's existing template. Writes nothing. */
    public Preview preview(UUID workspaceId, UUID workflowId, UUID actorId) {
        workspaceAuthorization.require(workspaceId, actorId, EDIT_CAPABILITY);
        SanitizedTemplate sanitized = sanitizeDraft(workspaceId, workflowId, actorId);
        return new Preview(sanitized, store.findLiveBySourceWorkflow(workflowId));
    }

    /** Creates the template for this workflow, or refreshes the snapshot of the one its owner already shared. */
    public Upserted share(UUID workspaceId, UUID workflowId, UUID actorId, ShareInput in) {
        workspaceAuthorization.require(workspaceId, actorId, EDIT_CAPABILITY);
        String name = name(in.name());
        String description = blankToNull(in.description(), MAX_DESCRIPTION, "description");
        String author = blankToNull(in.authorName(), MAX_AUTHOR, "authorName");
        if (in.visibility() == null) {
            throw new BadRequestException("visibility is required");
        }
        SanitizedTemplate sanitized = sanitizeDraft(workspaceId, workflowId, actorId);
        if (sanitized.definition().nodes().isEmpty()) {
            throw new BadRequestException("The workflow has no steps to share");
        }
        List<String> nodeTypes = nodeTypes(sanitized.definition());
        Map<String, Object> definition = DefinitionMaps.toMap(sanitized.definition());
        Instant now = clock.instant();

        Optional<Template> existing = store.findLiveBySourceWorkflow(workflowId);
        if (existing.isEmpty()) {
            if (store.countLiveByOwner(actorId) >= MAX_TEMPLATES_PER_OWNER) {
                throw new ConflictException("TEMPLATE_LIMIT_REACHED",
                        "You can share at most " + MAX_TEMPLATES_PER_OWNER + " templates");
            }
            try {
                Template created = store.insert(new Template(UUID.randomUUID(), actorId, workspaceId, workflowId,
                        name, description, author, definition, sanitized.editorState(), nodeTypes, in.visibility(),
                        null, 0, now, now));
                log.info("Template shared: id={} visibility={} nodes={}", created.id(), created.visibility(),
                        nodeTypes.size());
                return new Upserted(created, true);
            } catch (DuplicateKeyException e) {
                // Lost a race on the one-template-per-workflow index: take the normal path against the winner.
                existing = store.findLiveBySourceWorkflow(workflowId);
                if (existing.isEmpty()) {
                    throw new ConflictException("TEMPLATE_OWNED_BY_OTHER",
                            "Another member already shared this workflow as a template");
                }
            }
        }
        Template old = existing.get();
        if (!old.ownerId().equals(actorId)) {
            throw new ConflictException("TEMPLATE_OWNED_BY_OTHER",
                    "Another member already shared this workflow as a template");
        }
        Template updated = store.update(new Template(old.id(), old.ownerId(), old.workspaceId(),
                old.sourceWorkflowId(), name, description, author, definition, sanitized.editorState(),
                nodeTypes, in.visibility(), old.shareCode(), old.usageCount(), old.createdAt(), now));
        return new Upserted(updated, false);
    }

    public Template get(UUID id, Caller caller) {
        return store.findLive(id).filter(template -> visible(template, caller))
                .orElseThrow(() -> new ResourceNotFoundException("Template not found"));
    }

    /** Only UNLISTED and PUBLIC templates resolve by code; a PRIVATE one is as good as unknown. */
    public Template getByCode(String code, Caller caller) {
        return ShareCode.normalize(code).flatMap(store::findLiveByCode)
                .filter(template -> template.visibility() != TemplateVisibility.PRIVATE)
                .orElseThrow(() -> new ResourceNotFoundException("Template not found"));
    }

    public TemplateStore.Page list(TemplateStore.Scope scope, UUID workspaceId, String query, int page, int size,
                                   Caller caller) {
        if (page < 0 || size < 1 || size > 100) {
            throw new BadRequestException("Template page bounds are invalid");
        }
        if (scope == TemplateStore.Scope.WORKSPACE) {
            if (workspaceId == null) {
                throw new BadRequestException("workspaceId is required for the workspace scope");
            }
            workspaceAuthorization.require(workspaceId, caller.userId(), MEMBER_CAPABILITY);
        }
        return store.list(scope, caller.userId(), workspaceId, query, page, size);
    }

    /** The owner edits freely; a system admin can only take a PUBLIC template down (set it PRIVATE). */
    public Template update(UUID id, Caller caller, PatchInput in) {
        Template template = get(id, caller);
        boolean owner = template.ownerId().equals(caller.userId());
        if (!owner) {
            boolean takedown = caller.admin() && template.visibility() == TemplateVisibility.PUBLIC
                    && in.name() == null && in.description() == null
                    && in.visibility() == TemplateVisibility.PRIVATE;
            if (!takedown) {
                throw new ForbiddenException();
            }
            log.info("Template unpublished by admin: id={}", template.id());
        }
        return store.update(new Template(template.id(), template.ownerId(), template.workspaceId(),
                template.sourceWorkflowId(), in.name() == null ? template.name() : name(in.name()),
                in.description() == null ? template.description()
                        : blankToNull(in.description(), MAX_DESCRIPTION, "description"),
                template.authorName(), template.definition(), template.editorState(), template.nodeTypes(),
                in.visibility() == null ? template.visibility() : in.visibility(), template.shareCode(),
                template.usageCount(), template.createdAt(), clock.instant()));
    }

    public void delete(UUID id, Caller caller) {
        Template template = get(id, caller);
        if (!template.ownerId().equals(caller.userId())) {
            throw new ForbiddenException();
        }
        store.softDelete(id, clock.instant());
    }

    /** Copies the template into {@code targetWorkspaceId} as a new draft and counts the use, in one transaction. */
    public UUID use(UUID id, Caller caller, UUID targetWorkspaceId, String name) {
        Template template = get(id, caller);
        workspaceAuthorization.require(targetWorkspaceId, caller.userId(), CREATE_CAPABILITY);
        String workflowName = name == null || name.isBlank() ? template.name() : name(name);
        WorkflowDefinition definition = toDefinition(template.definition());
        UUID workflowId = transactions.execute(status -> {
            Workflow created = drafts.createWithDraft(new CreateWorkflowCommand(targetWorkspaceId, caller.userId(),
                    workflowName, template.description()), definition, template.editorState());
            store.incrementUsage(template.id());
            return created.getId();
        });
        log.info("Template used: id={} workflowId={}", template.id(), workflowId);
        return workflowId;
    }

    private SanitizedTemplate sanitizeDraft(UUID workspaceId, UUID workflowId, UUID actorId) {
        Workflow workflow = drafts.get(workspaceId, workflowId, actorId);
        return sanitizer.sanitize(toDefinition(workflow.getDraftDefinition()), workflow.getEditorState());
    }

    /** A stored definition that no longer parses is a client-visible 400, not a server error. */
    private static WorkflowDefinition toDefinition(Map<String, Object> stored) {
        try {
            return DefinitionMaps.toDefinition(stored);
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("The stored workflow definition is malformed and cannot be used as a template");
        }
    }

    private boolean visible(Template template, Caller caller) {
        if (template.ownerId().equals(caller.userId()) || template.visibility() != TemplateVisibility.PRIVATE) {
            return true;
        }
        try {
            workspaceAuthorization.require(template.workspaceId(), caller.userId(), MEMBER_CAPABILITY);
            return true;
        } catch (ForbiddenException | ResourceNotFoundException e) {
            return false;
        }
    }

    private static List<String> nodeTypes(WorkflowDefinition definition) {
        LinkedHashSet<String> types = new LinkedHashSet<>();
        definition.nodes().forEach(node -> types.add(node.type()));
        return List.copyOf(types);
    }

    private static String name(String value) {
        String name = value == null ? "" : value.strip();
        if (name.isEmpty() || name.length() > MAX_NAME) {
            throw new BadRequestException("Template name must be 1 to " + MAX_NAME + " characters");
        }
        return name;
    }

    private static String blankToNull(String value, int max, String field) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String text = value.strip();
        if (text.length() > max) {
            throw new BadRequestException(field + " must be at most " + max + " characters");
        }
        return text;
    }

    /** Capability that every workspace member has (the monitoring view): "is a member of this workspace". */
    static final String MEMBER_CAPABILITY = "WORKFLOW_MONITOR";

    public record Caller(UUID userId, boolean admin) {
    }

    public record ShareInput(String name, String description, String authorName, TemplateVisibility visibility) {
    }

    public record PatchInput(String name, String description, TemplateVisibility visibility) {
    }

    public record Preview(SanitizedTemplate sanitized, Optional<Template> existing) {
    }

    public record Upserted(Template template, boolean created) {
    }
}
