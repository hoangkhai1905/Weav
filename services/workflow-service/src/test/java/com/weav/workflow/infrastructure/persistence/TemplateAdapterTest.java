package com.weav.workflow.infrastructure.persistence;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.port.out.TemplateStore;
import com.weav.workflow.application.port.out.TemplateStore.Scope;
import com.weav.workflow.application.port.out.TemplateStore.Template;
import com.weav.workflow.domain.valueobject.TemplateVisibility;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DuplicateKeyException;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** PostgreSQL integration tests for the template store (JSONB, text[], partial indexes, listing). */
@SpringBootTest(properties = {
        "weav.workflow.execution-outbox.initial-delay=3600000",
        "weav.workflow.execution-outbox.poll-interval=3600000"
})
@Import(WorkflowPublicationTestConfiguration.class)
class TemplateAdapterTest {
    private static final Instant BASE = Instant.parse("2026-10-09T03:00:00Z");

    @Autowired
    private TemplateStore store;

    private static Template template(UUID owner, UUID workspace, UUID sourceWorkflow, String name,
                                     TemplateVisibility visibility, int minutes) {
        Instant at = BASE.plus(minutes, ChronoUnit.MINUTES);
        return new Template(UUID.randomUUID(), owner, workspace, sourceWorkflow, name, "desc of " + name, "Author",
                Map.of("schemaVersion", "1.0", "nodes", List.of(Map.of("id", "a", "type", "trigger.manual",
                        "config", Map.of("n", 1))), "edges", List.of(), "variables", Map.of()),
                Map.of("nodes", Map.of("a", Map.of("name", "Start"))), List.of("trigger.manual", "email.send"),
                visibility, null, 0, at, at);
    }

    @Autowired
    private org.springframework.jdbc.core.JdbcTemplate jdbc;
    @Autowired
    private tools.jackson.databind.ObjectMapper json;

    @Test
    void shareCodeClashRedrawsTheCodeInsteadOfFailing() {
        Template first = store.insert(template(UUID.randomUUID(), UUID.randomUUID(), null, "First",
                TemplateVisibility.PUBLIC, 0));
        // Draws the existing code first (clash), then ZZZZZZZZ.
        int[] script = first.shareCode().chars().map(c -> com.weav.workflow.domain.template.ShareCode.ALPHABET
                .indexOf(c)).toArray();
        int[] position = {0};
        java.util.random.RandomGenerator scripted = new java.util.random.RandomGenerator() {
            @Override
            public long nextLong() {
                return 0;
            }

            @Override
            public int nextInt(int bound) {
                int next = position[0] < script.length ? script[position[0]] : bound - 1;
                position[0]++;
                return next;
            }
        };
        com.weav.workflow.infrastructure.persistence.repository.TemplateAdapter adapter =
                new com.weav.workflow.infrastructure.persistence.repository.TemplateAdapter(jdbc, json, "workflow",
                        scripted);

        Template second = adapter.insert(template(UUID.randomUUID(), UUID.randomUUID(), null, "Second",
                TemplateVisibility.PUBLIC, 1));

        assertEquals("ZZZZZZZZ", second.shareCode());
        assertEquals(first.id(), store.findLiveByCode(first.shareCode()).orElseThrow().id());
        assertEquals(second.id(), store.findLiveByCode("ZZZZZZZZ").orElseThrow().id());
    }

    @Test
    void insertAndFindRoundTripJsonbAndTextArray() {
        Template saved = store.insert(template(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "Round trip",
                TemplateVisibility.UNLISTED, 0));

        Template found = store.findLive(saved.id()).orElseThrow();
        assertEquals("Round trip", found.name());
        assertEquals(List.of("trigger.manual", "email.send"), found.nodeTypes());
        assertEquals("1.0", found.definition().get("schemaVersion"));
        assertEquals("Start", ((Map<?, ?>) ((Map<?, ?>) found.editorState().get("nodes")).get("a")).get("name"));
        assertEquals(TemplateVisibility.UNLISTED, found.visibility());
        assertEquals(8, found.shareCode().length());
        assertEquals(0, found.usageCount());
        assertEquals(found.id(), store.findLiveByCode(found.shareCode()).orElseThrow().id());
    }

    @Test
    void softDeletedRowsAreInvisibleEverywhere() {
        UUID owner = UUID.randomUUID();
        UUID workflow = UUID.randomUUID();
        Template saved = store.insert(template(owner, UUID.randomUUID(), workflow, "Gone", TemplateVisibility.PUBLIC, 0));
        store.softDelete(saved.id(), BASE);

        assertTrue(store.findLive(saved.id()).isEmpty());
        assertTrue(store.findLiveByCode(saved.shareCode()).isEmpty());
        assertTrue(store.findLiveBySourceWorkflow(workflow).isEmpty());
        assertEquals(0, store.countLiveByOwner(owner));
        assertFalse(store.incrementUsage(saved.id()));
        // the source workflow can be shared again once the old template is deleted
        store.insert(template(owner, UUID.randomUUID(), workflow, "Again", TemplateVisibility.PRIVATE, 1));
    }

    @Test
    void secondLiveTemplateForTheSameWorkflowIsRejected() {
        UUID workflow = UUID.randomUUID();
        store.insert(template(UUID.randomUUID(), UUID.randomUUID(), workflow, "One", TemplateVisibility.PRIVATE, 0));

        assertThrows(DuplicateKeyException.class, () -> store.insert(
                template(UUID.randomUUID(), UUID.randomUUID(), workflow, "Two", TemplateVisibility.PRIVATE, 1)));
    }

    @Test
    void publicListSearchesNameAndDescriptionAndOrdersByUsageThenRecency() {
        String tag = "hoadon" + UUID.randomUUID().toString().substring(0, 8);
        UUID owner = UUID.randomUUID();
        Template older = store.insert(template(owner, UUID.randomUUID(), null, tag + " cu", TemplateVisibility.PUBLIC, 0));
        Template newer = store.insert(template(owner, UUID.randomUUID(), null, tag + " moi", TemplateVisibility.PUBLIC, 5));
        Template popular = store.insert(template(owner, UUID.randomUUID(), null, tag + " hot", TemplateVisibility.PUBLIC, -5));
        store.insert(template(owner, UUID.randomUUID(), null, tag + " hidden", TemplateVisibility.UNLISTED, 9));
        store.incrementUsage(popular.id());
        store.incrementUsage(popular.id());

        TemplateStore.Page page = store.list(Scope.PUBLIC, UUID.randomUUID(), null, tag.toUpperCase(), 0, 10);

        assertEquals(List.of(popular.id(), newer.id(), older.id()), page.items().stream().map(Template::id).toList());
        assertEquals(3, page.totalElements());
        assertEquals(2, page.items().get(0).usageCount());
        assertEquals(1, store.list(Scope.PUBLIC, UUID.randomUUID(), null, tag, 1, 2).items().size());
        assertEquals(1, store.list(Scope.PUBLIC, UUID.randomUUID(), null, "desc of " + tag + " hot", 0, 10)
                .items().size());
    }

    @Test
    void searchTreatsPercentAndUnderscoreLiterally() {
        UUID owner = UUID.randomUUID();
        String tag = UUID.randomUUID().toString().substring(0, 8);
        store.insert(template(owner, UUID.randomUUID(), null, tag + " 100% sure", TemplateVisibility.PUBLIC, 0));
        store.insert(template(owner, UUID.randomUUID(), null, tag + " 1000 sure", TemplateVisibility.PUBLIC, 1));

        List<Template> found = store.list(Scope.PUBLIC, owner, null, tag + " 100%", 0, 10).items();
        assertEquals(1, found.size());
        assertEquals(tag + " 100% sure", found.get(0).name());
        assertEquals(0, store.list(Scope.PUBLIC, owner, null, tag + " _000", 0, 10).items().size());
    }

    @Test
    void workspaceScopeReturnsOnlyPrivateRowsOfThatWorkspaceAndMineReturnsEverything() {
        UUID owner = UUID.randomUUID();
        UUID workspace = UUID.randomUUID();
        Template privateOne = store.insert(template(owner, workspace, null, "Team", TemplateVisibility.PRIVATE, 0));
        store.insert(template(owner, workspace, null, "Public in ws", TemplateVisibility.PUBLIC, 1));
        store.insert(template(owner, UUID.randomUUID(), null, "Other ws", TemplateVisibility.PRIVATE, 2));

        assertEquals(List.of(privateOne.id()), store.list(Scope.WORKSPACE, UUID.randomUUID(), workspace, null, 0, 10)
                .items().stream().map(Template::id).toList());
        assertEquals(3, store.list(Scope.MINE, owner, null, null, 0, 10).totalElements());
        assertEquals(0, store.list(Scope.MINE, UUID.randomUUID(), null, null, 0, 10).totalElements());
        assertEquals(3, store.countLiveByOwner(owner));
    }

    @Test
    void updateReplacesEditableFieldsAndKeepsCodeAndUsage() {
        Template saved = store.insert(template(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "Before",
                TemplateVisibility.PRIVATE, 0));
        store.incrementUsage(saved.id());
        Template changed = new Template(saved.id(), saved.ownerId(), saved.workspaceId(), saved.sourceWorkflowId(),
                "After", null, "New Author", Map.of("schemaVersion", "1.1"), null, List.of("data.set"),
                TemplateVisibility.PUBLIC, "IGNORED0", 99, saved.createdAt(), BASE.plusSeconds(60));

        store.update(changed);

        Template reloaded = store.findLive(saved.id()).orElseThrow();
        assertEquals("After", reloaded.name());
        assertEquals(TemplateVisibility.PUBLIC, reloaded.visibility());
        assertEquals(List.of("data.set"), reloaded.nodeTypes());
        assertEquals(saved.shareCode(), reloaded.shareCode());
        assertEquals(1, reloaded.usageCount());
        assertNotNull(reloaded.definition());
        assertNull(reloaded.description());
        assertNull(reloaded.editorState());
    }
}
