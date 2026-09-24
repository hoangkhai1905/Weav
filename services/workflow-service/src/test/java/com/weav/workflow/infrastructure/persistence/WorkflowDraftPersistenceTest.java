package com.weav.workflow.infrastructure.persistence;

import com.weav.workflow.WorkflowDraftTestConfiguration;
import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest
@Import(WorkflowDraftTestConfiguration.class)
class WorkflowDraftPersistenceTest {

    @Autowired
    private WorkflowDraftService workflowDraftService;

    @Autowired
    private WorkflowRepository workflowRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private EntityManager entityManager;

    @Test
    @Transactional
    void persistenceMappingPreservesExplicitIdentifiersTimestampsAndNestedNulls() {
        UUID id = UUID.fromString("40000000-0000-0000-0000-000000000051");
        UUID workspaceId = UUID.fromString("10000000-0000-0000-0000-000000000061");
        UUID actorId = UUID.fromString("20000000-0000-0000-0000-000000000061");
        Instant createdAt = Instant.parse("2026-01-02T03:04:05Z");
        Instant updatedAt = Instant.parse("2026-02-03T04:05:06Z");
        Map<String, Object> nested = new LinkedHashMap<>();
        nested.put("explicitNull", null);
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("schemaVersion", "1.0");
        definition.put("nodes", List.of(Map.of("id", "manual", "type", "trigger.manual", "config", Map.of())));
        definition.put("edges", List.of());
        definition.put("variables", nested);
        Map<String, Object> editorState = new LinkedHashMap<>();
        editorState.put("selected", null);

        Workflow original = new Workflow(id, workspaceId, "Explicit identity", null, WorkflowStatus.DRAFT,
                "1.0", definition, editorState, null, actorId, createdAt, updatedAt, null, null, null);
        workflowRepository.save(original);
        entityManager.flush();
        entityManager.clear();

        Workflow restored = workflowRepository.findByWorkspaceAndId(workspaceId, id).orElseThrow();
        assertEquals(id, restored.getId());
        assertEquals(createdAt, restored.getCreatedAt());
        assertEquals(updatedAt, restored.getUpdatedAt());
        assertTrue(((Map<?, ?>) restored.getDraftDefinition().get("variables")).containsKey("explicitNull"));
        assertNull(((Map<?, ?>) restored.getDraftDefinition().get("variables")).get("explicitNull"));
        assertTrue(restored.getEditorState().containsKey("selected"));
        assertNull(restored.getEditorState().get("selected"));
    }

    @Test
    void listAndScopedLookupsExcludeDeletedRowsAndUseStablePagination() {
        UUID workspaceId = UUID.fromString("10000000-0000-0000-0000-000000000062");
        UUID actorId = UUID.fromString("20000000-0000-0000-0000-000000000062");
        Instant sameCreatedAt = Instant.parse("2026-03-01T00:00:00Z");
        UUID firstId = UUID.fromString("40000000-0000-0000-0000-000000000061");
        UUID secondId = UUID.fromString("40000000-0000-0000-0000-000000000062");
        UUID thirdId = UUID.fromString("40000000-0000-0000-0000-000000000063");
        workflowRepository.save(workflow(firstId, workspaceId, actorId, "First", sameCreatedAt));
        workflowRepository.save(workflow(secondId, workspaceId, actorId, "Second", sameCreatedAt));
        workflowRepository.save(workflow(thirdId, workspaceId, actorId, "Third", sameCreatedAt));
        jdbcTemplate.update("update workflow.workflows set deleted_at = ? where id = ?",
                Timestamp.from(Instant.parse("2026-03-02T00:00:00Z")), thirdId);

        assertTrue(workflowRepository.findByWorkspaceAndId(workspaceId, thirdId).isEmpty());
        assertEquals(2, workflowRepository.countByWorkspace(workspaceId));
        List<Workflow> firstPage = workflowRepository.findPage(workspaceId, 0, 1);
        List<Workflow> secondPage = workflowRepository.findPage(workspaceId, 1, 1);
        assertEquals(List.of(secondId), firstPage.stream().map(Workflow::getId).toList());
        assertEquals(List.of(firstId), secondPage.stream().map(Workflow::getId).toList());
        assertTrue(workflowRepository.findByWorkspaceAndId(UUID.randomUUID(), firstId).isEmpty());
    }

    @Test
    void concurrentSavesCommitWholeDraftSnapshotsUnderTheWorkflowRowLock() throws Exception {
        UUID workspaceId = UUID.fromString("10000000-0000-0000-0000-000000000063");
        UUID actorId = UUID.fromString("20000000-0000-0000-0000-000000000063");
        Workflow created = workflowDraftService.create(new CreateWorkflowCommand(
                workspaceId, actorId, "Concurrent base", "base"));

        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            List<Future<?>> writes = new ArrayList<>();
            for (String marker : List.of("A", "B")) {
                writes.add(executor.submit(() -> {
                    ready.countDown();
                    if (!start.await(10, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("Concurrent save start was not released");
                    }
                    workflowDraftService.save(workspaceId, created.getId(), actorId,
                            "name-" + marker, "description-" + marker, definition(marker),
                            Map.of("marker", marker));
                    return null;
                }));
            }
            assertTrue(ready.await(10, TimeUnit.SECONDS));
            start.countDown();
            for (Future<?> write : writes) {
                write.get(30, TimeUnit.SECONDS);
            }
        } finally {
            executor.shutdownNow();
            assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS));
        }

        Workflow saved = workflowRepository.findByWorkspaceAndId(workspaceId, created.getId()).orElseThrow();
        String nameMarker = saved.getName().substring("name-".length());
        String descriptionMarker = saved.getDescription().substring("description-".length());
        Object variablesValue = saved.getDraftDefinition().get("variables");
        String definitionMarker = variablesValue instanceof Map<?, ?> variables
                ? (String) variables.get("marker") : null;
        String editorMarker = (String) saved.getEditorState().get("marker");
        assertTrue(List.of("A", "B").contains(nameMarker));
        assertEquals(nameMarker, descriptionMarker);
        assertEquals(nameMarker, definitionMarker);
        assertEquals(nameMarker, editorMarker);
    }

    @Test
    @Transactional
    void rowLockRefreshesAnEntityAlreadyLoadedBeforeTheLockWasTaken() {
        UUID workspaceId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        Workflow existing = Workflow.createDraft(workspaceId, "Loaded before lock", null, actorId);
        workflowRepository.save(existing);
        entityManager.flush();
        assertEquals(WorkflowStatus.DRAFT,
                workflowRepository.findByWorkspaceAndId(workspaceId, existing.getId()).orElseThrow().getStatus());

        jdbcTemplate.update("update workflow.workflows set status = 'PAUSED' where id = ?", existing.getId());

        Workflow locked = workflowRepository.lockByWorkspaceAndId(workspaceId, existing.getId()).orElseThrow();

        assertEquals(WorkflowStatus.PAUSED, locked.getStatus());
    }

    @Test
    void editingPublishedWorkflowChangesDraftWithoutChangingPublishedSnapshotReference() {
        UUID workspaceId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        Workflow existing = Workflow.createDraft(workspaceId, "Published draft", "before", actorId);
        Instant publishedAt = Instant.parse("2026-04-05T06:07:08Z");
        workflowRepository.save(existing);
        jdbcTemplate.update("insert into workflow.workflow_versions "
                        + "(id, workflow_id, version_number, definition, schema_version, published_by, created_at) "
                        + "values (?, ?, 1, cast(? as jsonb), '1.0', ?, ?)",
                versionId, existing.getId(), "{}", actorId, Timestamp.from(publishedAt));
        jdbcTemplate.update("update workflow.workflows set status = 'PUBLISHED', current_version_id = ?, "
                        + "published_at = ? where id = ?",
                versionId, Timestamp.from(publishedAt), existing.getId());

        Workflow savedDraft = workflowDraftService.save(workspaceId, existing.getId(), actorId,
                "Edited after publish", "draft only", definition("after-publish"), Map.of("layout", "new"));

        Workflow restored = workflowRepository.findByWorkspaceAndId(workspaceId, existing.getId()).orElseThrow();
        assertEquals("Edited after publish", restored.getName());
        assertEquals("draft only", restored.getDescription());
        assertEquals("after-publish", ((Map<?, ?>) restored.getDraftDefinition().get("variables")).get("marker"));
        assertEquals(WorkflowStatus.PUBLISHED, savedDraft.getStatus());
        assertEquals(WorkflowStatus.PUBLISHED, restored.getStatus());
        assertEquals(versionId, restored.getCurrentVersionId());
        assertEquals(publishedAt, restored.getPublishedAt());
        assertEquals(versionId, jdbcTemplate.queryForObject(
                "select current_version_id from workflow.workflows where id = ?", UUID.class, existing.getId()));
    }

    @Test
    void pageBoundsAreEnforcedBeforeAnInvalidDatabaseOffsetIsBuilt() {
        UUID workspaceId = UUID.fromString("10000000-0000-0000-0000-000000000064");
        UUID actorId = UUID.fromString("20000000-0000-0000-0000-000000000064");
        assertThrows(RuntimeException.class, () -> workflowDraftService.list(workspaceId, actorId, -1, 20));
        assertThrows(RuntimeException.class, () -> workflowDraftService.list(workspaceId, actorId, 0, 101));
    }

    private Workflow workflow(UUID id, UUID workspaceId, UUID actorId, String name, Instant createdAt) {
        return new Workflow(id, workspaceId, name, null, WorkflowStatus.DRAFT, "1.0",
                definitionMap(name), Map.of(), null, actorId, createdAt, createdAt, null, null, null);
    }

    private WorkflowDefinition definition(String marker) {
        return new WorkflowDefinition("1.0",
                List.of(new WorkflowDefinition.Node("manual", "trigger.manual", Map.of())),
                List.of(), Map.of("marker", marker));
    }

    private Map<String, Object> definitionMap(String marker) {
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("schemaVersion", "1.0");
        definition.put("nodes", List.of(Map.of("id", "manual", "type", "trigger.manual", "config", Map.of())));
        definition.put("edges", List.of());
        definition.put("variables", Map.of("marker", marker));
        return definition;
    }
}
