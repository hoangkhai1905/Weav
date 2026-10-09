package com.weav.workflow.application.service;

import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.port.out.TemplateStore;
import com.weav.workflow.application.port.out.TemplateStore.Template;
import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.service.TemplateService.Caller;
import com.weav.workflow.application.service.TemplateService.PatchInput;
import com.weav.workflow.application.service.TemplateService.ShareInput;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.exception.ConflictException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.domain.exception.ResourceNotFoundException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.valueobject.TemplateVisibility;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.support.TransactionOperations;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TemplateServiceTest {
    private static final Instant NOW = Instant.parse("2026-10-09T03:00:00Z");
    private static final UUID OWNER = UUID.randomUUID();
    private static final UUID STRANGER = UUID.randomUUID();
    private static final UUID MEMBER = UUID.randomUUID();
    private static final UUID SOURCE_WS = UUID.randomUUID();
    private static final UUID TARGET_WS = UUID.randomUUID();

    private final FakeStore store = new FakeStore();
    private final WorkflowDraftService drafts = mock(WorkflowDraftService.class);
    /** Workspace -> user -> capabilities; a missing workspace behaves like a deleted one (404). */
    private final Map<UUID, Map<UUID, Set<String>>> access = new HashMap<>();
    private TemplateService service;

    @BeforeEach
    void setUp() {
        access.put(SOURCE_WS, Map.of(OWNER, Set.of("WORKFLOW_EDIT", "WORKSPACE_VIEW", "WORKFLOW_MONITOR"),
                MEMBER, Set.of("WORKFLOW_MONITOR")));
        access.put(TARGET_WS, new HashMap<>(Map.of(STRANGER, Set.of("WORKFLOW_CREATE", "WORKFLOW_MONITOR"))));
        WorkspaceAuthorization authorization = new WorkspaceAuthorization((workspace, user) -> {
            Map<UUID, Set<String>> members = access.get(workspace);
            if (members == null) {
                throw new ResourceNotFoundException("Workspace not found");
            }
            return new WorkspaceAccessPort.Access(workspace, user, "MEMBER", members.getOrDefault(user, Set.of()));
        });
        TransactionOperations tx = new TransactionOperations() {
            @Override
            public <T> T execute(org.springframework.transaction.support.TransactionCallback<T> action) {
                return action.doInTransaction(null);
            }
        };
        service = new TemplateService(authorization, drafts, store, tx, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private Workflow sourceWorkflow(Map<String, Object> config) {
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("schemaVersion", "1.0");
        definition.put("nodes", List.of(
                Map.of("id", "manual", "type", "trigger.manual", "config", Map.of()),
                Map.of("id", "send_email", "type", "email.send", "config", config)));
        definition.put("edges", List.of(Map.of("id", "e1", "source", "manual", "target", "send_email")));
        definition.put("variables", Map.of("apiBase", "https://x"));
        Workflow workflow = Workflow.createDraft(SOURCE_WS, "Invoices", null, OWNER);
        workflow.updateDraft("Invoices", null, definition,
                Map.of("nodes", Map.of("send_email", Map.of("name", "Gui", "junk", 1))));
        return workflow;
    }

    private UUID stubSource(Map<String, Object> config) {
        Workflow workflow = sourceWorkflow(config);
        when(drafts.get(SOURCE_WS, workflow.getId(), OWNER)).thenReturn(workflow);
        return workflow.getId();
    }

    private static ShareInput input(TemplateVisibility visibility) {
        return new ShareInput("  Hoa don  ", "desc", "Khai", visibility);
    }

    private static Map<String, Object> mailConfig() {
        return Map.of("connectionId", UUID.randomUUID().toString(), "to", "boss@x.com", "subject", "Hi",
                "body", "Hello");
    }

    private Template seed(UUID owner, TemplateVisibility visibility) {
        return store.insert(new Template(UUID.randomUUID(), owner, SOURCE_WS, UUID.randomUUID(), "T", "d", "A",
                Map.of("schemaVersion", "1.0", "nodes", List.of(Map.of("id", "m", "type", "trigger.manual",
                        "config", Map.of())), "edges", List.of(), "variables", Map.of()),
                null, List.of("trigger.manual"), visibility, null, 0, NOW, NOW));
    }

    // ------------------------------------------------------------------ share / preview

    @Test
    void shareStoresTheSanitizedSnapshotWithTrimmedFields() {
        UUID workflowId = stubSource(mailConfig());

        TemplateService.Upserted result = service.share(SOURCE_WS, workflowId, OWNER, input(TemplateVisibility.UNLISTED));

        assertTrue(result.created());
        Template saved = result.template();
        assertEquals("Hoa don", saved.name());
        assertEquals(List.of("trigger.manual", "email.send"), saved.nodeTypes());
        assertEquals(workflowId, saved.sourceWorkflowId());
        assertNotNull(saved.shareCode());
        String stored = saved.definition().toString();
        assertFalse(stored.contains("boss@x.com"));
        assertFalse(stored.contains("connectionId"));
        assertEquals(Map.of("apiBase", ""), saved.definition().get("variables"));
        assertEquals(Map.of("nodes", Map.of("send_email", Map.of("name", "Gui"))), saved.editorState());
    }

    @Test
    void previewWritesNothingAndReportsExistingTemplate() {
        UUID workflowId = stubSource(mailConfig());

        TemplateService.Preview preview = service.preview(SOURCE_WS, workflowId, OWNER);
        assertTrue(preview.existing().isEmpty());
        assertEquals(2, preview.sanitized().removedFields().size());
        assertEquals(0, store.rows.size());

        service.share(SOURCE_WS, workflowId, OWNER, input(TemplateVisibility.PRIVATE));
        assertTrue(service.preview(SOURCE_WS, workflowId, OWNER).existing().isPresent());
    }

    @Test
    void reShareKeepsIdAndCodeAndReplacesTheSnapshot() {
        UUID workflowId = stubSource(mailConfig());
        Template first = service.share(SOURCE_WS, workflowId, OWNER, input(TemplateVisibility.PRIVATE)).template();

        TemplateService.Upserted second = service.share(SOURCE_WS, workflowId, OWNER,
                new ShareInput("Renamed", null, null, TemplateVisibility.PUBLIC));

        assertFalse(second.created());
        assertEquals(first.id(), second.template().id());
        assertEquals(first.shareCode(), second.template().shareCode());
        assertEquals("Renamed", second.template().name());
        assertEquals(TemplateVisibility.PUBLIC, second.template().visibility());
        assertEquals(1, store.rows.size());
    }

    @Test
    void anotherEditorCannotReShareSomeoneElsesTemplate() {
        UUID workflowId = stubSource(mailConfig());
        service.share(SOURCE_WS, workflowId, OWNER, input(TemplateVisibility.PRIVATE));
        UUID otherEditor = UUID.randomUUID();
        access.put(SOURCE_WS, Map.of(OWNER, Set.of("WORKFLOW_EDIT", "WORKSPACE_VIEW"),
                otherEditor, Set.of("WORKFLOW_EDIT", "WORKSPACE_VIEW")));
        when(drafts.get(SOURCE_WS, workflowId, otherEditor)).thenReturn(sourceWorkflow(mailConfig()));

        ConflictException conflict = assertThrows(ConflictException.class,
                () -> service.share(SOURCE_WS, workflowId, otherEditor, input(TemplateVisibility.PRIVATE)));
        assertEquals("TEMPLATE_OWNED_BY_OTHER", conflict.getCode());
    }

    @Test
    void concurrentFirstShareBySameOwnerFallsBackToTheUpdatePath() {
        UUID workflowId = stubSource(mailConfig());
        store.rivalOnInsert = rivalFor(workflowId, OWNER);

        TemplateService.Upserted result = service.share(SOURCE_WS, workflowId, OWNER,
                new ShareInput("Mine", null, null, TemplateVisibility.PUBLIC));

        assertFalse(result.created());
        assertEquals("Mine", result.template().name());
        assertEquals(1, store.rows.size());
    }

    @Test
    void concurrentFirstShareByAnotherOwnerIsAConflict() {
        UUID workflowId = stubSource(mailConfig());
        store.rivalOnInsert = rivalFor(workflowId, STRANGER);

        ConflictException conflict = assertThrows(ConflictException.class,
                () -> service.share(SOURCE_WS, workflowId, OWNER, input(TemplateVisibility.PRIVATE)));
        assertEquals("TEMPLATE_OWNED_BY_OTHER", conflict.getCode());
    }

    private Template rivalFor(UUID workflowId, UUID owner) {
        return new Template(UUID.randomUUID(), owner, SOURCE_WS, workflowId, "Rival", null, null,
                Map.of("schemaVersion", "1.0", "nodes", List.of(), "edges", List.of(), "variables", Map.of()), null,
                List.of(), TemplateVisibility.PRIVATE, "RIVAL000", 0, NOW, NOW);
    }

    @Test
    void unsupportedNodeTypeCannotBeShared() {
        Workflow workflow = Workflow.createDraft(SOURCE_WS, "Legacy", null, OWNER);
        workflow.updateDraft("Legacy", null, Map.of("schemaVersion", "1.0", "nodes", List.of(
                Map.of("id", "old", "type", "legacy.node", "config", Map.of())), "edges", List.of(),
                "variables", Map.of()), null);
        when(drafts.get(SOURCE_WS, workflow.getId(), OWNER)).thenReturn(workflow);

        BadRequestException failure = assertThrows(BadRequestException.class,
                () -> service.preview(SOURCE_WS, workflow.getId(), OWNER));
        assertEquals("TEMPLATE_NODE_NOT_SHAREABLE", failure.getCode());
        assertThrows(BadRequestException.class, () -> service.share(SOURCE_WS, workflow.getId(), OWNER,
                input(TemplateVisibility.PRIVATE)));
        assertEquals(0, store.rows.size());
    }

    @Test
    void malformedStoredDefinitionsAreBadRequestsNotServerErrors() {
        Workflow workflow = Workflow.createDraft(SOURCE_WS, "Broken", null, OWNER);
        workflow.updateDraft("Broken", null, Map.of("schemaVersion", "1.0", "nodes", "not-a-list"), null);
        when(drafts.get(SOURCE_WS, workflow.getId(), OWNER)).thenReturn(workflow);
        assertThrows(BadRequestException.class, () -> service.preview(SOURCE_WS, workflow.getId(), OWNER));
        assertThrows(BadRequestException.class, () -> service.share(SOURCE_WS, workflow.getId(), OWNER,
                input(TemplateVisibility.PRIVATE)));

        Template broken = store.insert(new Template(UUID.randomUUID(), OWNER, SOURCE_WS, null, "B", null, null,
                Map.of("nodes", "not-a-list"), null, List.of(), TemplateVisibility.PUBLIC, null, 0, NOW, NOW));
        assertThrows(BadRequestException.class,
                () -> service.use(broken.id(), new Caller(STRANGER, false), TARGET_WS, null));
        assertEquals(0, store.findLive(broken.id()).orElseThrow().usageCount());
    }

    @Test
    void theFiftyFirstTemplateIsRefused() {
        for (int i = 0; i < 50; i++) {
            seed(OWNER, TemplateVisibility.PRIVATE);
        }
        UUID workflowId = stubSource(mailConfig());

        ConflictException conflict = assertThrows(ConflictException.class,
                () -> service.share(SOURCE_WS, workflowId, OWNER, input(TemplateVisibility.PRIVATE)));
        assertEquals("TEMPLATE_LIMIT_REACHED", conflict.getCode());
    }

    @Test
    void shareValidatesInputAndNeedsEditCapability() {
        UUID workflowId = stubSource(mailConfig());
        assertThrows(BadRequestException.class, () -> service.share(SOURCE_WS, workflowId, OWNER,
                new ShareInput("   ", null, null, TemplateVisibility.PRIVATE)));
        assertThrows(BadRequestException.class, () -> service.share(SOURCE_WS, workflowId, OWNER,
                new ShareInput("x".repeat(256), null, null, TemplateVisibility.PRIVATE)));
        assertThrows(BadRequestException.class, () -> service.share(SOURCE_WS, workflowId, OWNER,
                new ShareInput("ok", null, null, null)));
        assertThrows(ForbiddenException.class, () -> service.share(SOURCE_WS, workflowId, MEMBER,
                input(TemplateVisibility.PRIVATE)));
        assertEquals(0, store.rows.size());
    }

    // ------------------------------------------------------------------ visibility

    @Test
    void visibilityMatrix() {
        Template pub = seed(OWNER, TemplateVisibility.PUBLIC);
        Template unlisted = seed(OWNER, TemplateVisibility.UNLISTED);
        Template priv = seed(OWNER, TemplateVisibility.PRIVATE);

        for (Template visibleToAll : List.of(pub, unlisted)) {
            assertEquals(visibleToAll.id(), service.get(visibleToAll.id(), new Caller(STRANGER, false)).id());
        }
        assertEquals(priv.id(), service.get(priv.id(), new Caller(OWNER, false)).id());
        assertEquals(priv.id(), service.get(priv.id(), new Caller(MEMBER, false)).id());
        assertThrows(ResourceNotFoundException.class, () -> service.get(priv.id(), new Caller(STRANGER, false)));
        assertThrows(ResourceNotFoundException.class, () -> service.get(priv.id(), new Caller(STRANGER, true)));
    }

    @Test
    void privateTemplateOfADeletedWorkspaceIsHiddenFromMembersButNotOwner() {
        Template priv = seed(OWNER, TemplateVisibility.PRIVATE);
        access.remove(SOURCE_WS);

        assertThrows(ResourceNotFoundException.class, () -> service.get(priv.id(), new Caller(MEMBER, false)));
        assertEquals(priv.id(), service.get(priv.id(), new Caller(OWNER, false)).id());
    }

    @Test
    void softDeletedTemplateIsNotFound() {
        Template pub = seed(OWNER, TemplateVisibility.PUBLIC);
        service.delete(pub.id(), new Caller(OWNER, false));

        assertThrows(ResourceNotFoundException.class, () -> service.get(pub.id(), new Caller(OWNER, false)));
    }

    @Test
    void codesResolveForUnlistedAndPublicOnlyAndAreTypedForgivingly() {
        Template unlisted = store.insert(withCode(seed(OWNER, TemplateVisibility.UNLISTED), "WV7K3M9Q"));
        Template priv = store.insert(withCode(seed(OWNER, TemplateVisibility.PRIVATE), "AAAAAAAA"));

        assertEquals(unlisted.id(), service.getByCode("wv7k-3m9q", new Caller(STRANGER, false)).id());
        assertThrows(ResourceNotFoundException.class,
                () -> service.getByCode("AAAAAAAA", new Caller(MEMBER, false)));
        assertThrows(ResourceNotFoundException.class,
                () -> service.getByCode("AAAAAAAA", new Caller(OWNER, false)));
        assertThrows(ResourceNotFoundException.class, () -> service.getByCode("nope", new Caller(OWNER, false)));
        assertNotNull(priv);
    }

    private Template withCode(Template t, String code) {
        store.rows.put(t.id(), new Template(t.id(), t.ownerId(), t.workspaceId(), t.sourceWorkflowId(), t.name(),
                t.description(), t.authorName(), t.definition(), t.editorState(), t.nodeTypes(), t.visibility(), code,
                t.usageCount(), t.createdAt(), t.updatedAt()));
        return store.rows.get(t.id());
    }

    // ------------------------------------------------------------------ list / update / delete

    @Test
    void workspaceScopeNeedsMembershipAndAWorkspaceId() {
        assertThrows(BadRequestException.class,
                () -> service.list(TemplateStore.Scope.WORKSPACE, null, null, 0, 20, new Caller(MEMBER, false)));
        assertThrows(ForbiddenException.class, () -> service.list(TemplateStore.Scope.WORKSPACE, SOURCE_WS, null, 0, 20,
                new Caller(STRANGER, false)));
        service.list(TemplateStore.Scope.WORKSPACE, SOURCE_WS, null, 0, 20, new Caller(MEMBER, false));
        assertThrows(BadRequestException.class,
                () -> service.list(TemplateStore.Scope.PUBLIC, null, null, 0, 101, new Caller(MEMBER, false)));
    }

    @Test
    void ownerEditsAdminOnlyTakesPublicTemplatesDown() {
        Template pub = seed(OWNER, TemplateVisibility.PUBLIC);

        assertEquals("Renamed", service.update(pub.id(), new Caller(OWNER, false),
                new PatchInput("Renamed", null, null)).name());
        assertThrows(ForbiddenException.class, () -> service.update(pub.id(), new Caller(STRANGER, true),
                new PatchInput("Admin rename", null, null)));
        assertThrows(ForbiddenException.class, () -> service.update(pub.id(), new Caller(STRANGER, false),
                new PatchInput(null, null, TemplateVisibility.PRIVATE)));
        assertEquals(TemplateVisibility.PRIVATE, service.update(pub.id(), new Caller(STRANGER, true),
                new PatchInput(null, null, TemplateVisibility.PRIVATE)).visibility());
        // once private, the admin no longer sees it
        assertThrows(ResourceNotFoundException.class, () -> service.update(pub.id(), new Caller(STRANGER, true),
                new PatchInput(null, null, TemplateVisibility.PUBLIC)));
    }

    @Test
    void onlyTheOwnerDeletes() {
        Template pub = seed(OWNER, TemplateVisibility.PUBLIC);

        assertThrows(ForbiddenException.class, () -> service.delete(pub.id(), new Caller(STRANGER, true)));
        service.delete(pub.id(), new Caller(OWNER, false));
        assertTrue(store.findLive(pub.id()).isEmpty());
    }

    // ------------------------------------------------------------------ use

    @Test
    void useCopiesTheDefinitionIntoTheTargetWorkspaceAndCountsIt() {
        Template pub = seed(OWNER, TemplateVisibility.PUBLIC);
        Workflow created = Workflow.createDraft(TARGET_WS, "T", null, STRANGER);
        when(drafts.createWithDraft(any(), any(), any())).thenReturn(created);

        UUID id = service.use(pub.id(), new Caller(STRANGER, false), TARGET_WS, null);

        assertEquals(created.getId(), id);
        ArgumentCaptor<CreateWorkflowCommand> command = ArgumentCaptor.forClass(CreateWorkflowCommand.class);
        ArgumentCaptor<WorkflowDefinition> definition = ArgumentCaptor.forClass(WorkflowDefinition.class);
        verify(drafts).createWithDraft(command.capture(), definition.capture(), any());
        assertEquals(TARGET_WS, command.getValue().workspaceId());
        assertEquals(STRANGER, command.getValue().actorId());
        assertEquals("T", command.getValue().name());
        assertEquals("trigger.manual", definition.getValue().nodes().get(0).type());
        assertEquals(1, store.findLive(pub.id()).orElseThrow().usageCount());
    }

    @Test
    void useWithoutCreateCapabilityIsForbiddenAndLeavesTheCountAlone() {
        Template pub = seed(OWNER, TemplateVisibility.PUBLIC);
        access.get(TARGET_WS).put(STRANGER, Set.of("WORKFLOW_MONITOR"));

        assertThrows(ForbiddenException.class, () -> service.use(pub.id(), new Caller(STRANGER, false), TARGET_WS, null));

        verify(drafts, never()).createWithDraft(any(), any(), any());
        assertEquals(0, store.findLive(pub.id()).orElseThrow().usageCount());
    }

    @Test
    void useOfAHiddenTemplateIsNotFoundAndAFailedCopyDoesNotCount() {
        Template priv = seed(OWNER, TemplateVisibility.PRIVATE);
        assertThrows(ResourceNotFoundException.class,
                () -> service.use(priv.id(), new Caller(STRANGER, false), TARGET_WS, null));

        Template pub = seed(OWNER, TemplateVisibility.PUBLIC);
        when(drafts.createWithDraft(any(), any(), any())).thenThrow(new BadRequestException("boom"));
        assertThrows(BadRequestException.class,
                () -> service.use(pub.id(), new Caller(STRANGER, false), TARGET_WS, "My copy"));
        assertEquals(0, store.findLive(pub.id()).orElseThrow().usageCount());
    }

    /** Minimal in-memory store: the SQL behaviour is covered by TemplateAdapterTest. */
    private static final class FakeStore implements TemplateStore {
        final Map<UUID, Template> rows = new LinkedHashMap<>();
        /** When set, the next insert first stores this row, then fails like a lost race on the source index. */
        Template rivalOnInsert;

        private static Template copy(Template t, String code, int usage) {
            return new Template(t.id(), t.ownerId(), t.workspaceId(), t.sourceWorkflowId(), t.name(), t.description(),
                    t.authorName(), t.definition(), t.editorState(), t.nodeTypes(), t.visibility(), code, usage,
                    t.createdAt(), t.updatedAt());
        }

        @Override
        public Template insert(Template t) {
            if (rivalOnInsert != null) {
                Template rival = rivalOnInsert;
                rivalOnInsert = null;
                rows.put(rival.id(), rival);
                throw new org.springframework.dao.DuplicateKeyException("uk_workflow_templates_source");
            }
            Template stored = copy(t, t.shareCode() != null ? t.shareCode() : UUID.randomUUID().toString().substring(0, 8)
                    .toUpperCase(), t.usageCount());
            rows.put(stored.id(), stored);
            return stored;
        }

        @Override
        public Template update(Template t) {
            Template stored = copy(t, rows.get(t.id()).shareCode(), rows.get(t.id()).usageCount());
            rows.put(stored.id(), stored);
            return stored;
        }

        @Override
        public Optional<Template> findLive(UUID id) {
            return Optional.ofNullable(rows.get(id));
        }

        @Override
        public Optional<Template> findLiveByCode(String code) {
            return rows.values().stream().filter(t -> code.equals(t.shareCode())).findFirst();
        }

        @Override
        public Optional<Template> findLiveBySourceWorkflow(UUID workflowId) {
            return rows.values().stream().filter(t -> workflowId.equals(t.sourceWorkflowId())).findFirst();
        }

        @Override
        public int countLiveByOwner(UUID ownerId) {
            return (int) rows.values().stream().filter(t -> t.ownerId().equals(ownerId)).count();
        }

        @Override
        public Page list(Scope scope, UUID callerId, UUID workspaceId, String query, int page, int size) {
            return new Page(new ArrayList<>(rows.values()), page, size, rows.size());
        }

        @Override
        public void softDelete(UUID id, Instant at) {
            rows.remove(id);
        }

        @Override
        public boolean incrementUsage(UUID id) {
            Template t = rows.get(id);
            if (t == null) {
                return false;
            }
            rows.put(id, copy(t, t.shareCode(), t.usageCount() + 1));
            return true;
        }
    }
}
