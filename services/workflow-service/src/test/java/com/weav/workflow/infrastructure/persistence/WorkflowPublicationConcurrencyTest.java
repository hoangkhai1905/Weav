package com.weav.workflow.infrastructure.persistence;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.service.DraftChangedException;
import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowVersion;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.application.port.out.WorkflowVersionPort;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** PostgreSQL-backed transaction, snapshot, rollback, and publication race regressions. */
@SpringBootTest
@Import(WorkflowPublicationTestConfiguration.class)
class WorkflowPublicationConcurrencyTest {

    private static final UUID ACTOR_ID = UUID.fromString("20000000-0000-0000-0000-000000000061");

    @Autowired
    private WorkflowRepository workflows;
    @Autowired
    private WorkflowPublicationService publicationService;
    @Autowired
    private WorkflowDraftService draftService;
    @Autowired
    private WorkflowVersionPort versions;
    @Autowired
    private WorkflowTriggerPort triggers;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private WorkflowPublicationTestConfiguration.PublicationAuthorizationGate authorizationGate;
    @Autowired
    private WorkflowPublicationTestConfiguration.PublicationRollbackInjector rollbackInjector;

    @AfterEach
    void releaseGates() {
        authorizationGate.reset();
        rollbackInjector.reset();
    }

    @Test
    void concurrentPublishersAllocateDistinctVersionsAndQueuedRunsStayPinned() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID connectionId = UUID.fromString("30000000-0000-0000-0000-000000000061");
        Workflow workflow = createDraft(workspaceId, "Concurrent publication");
        draftService.save(workspaceId, workflow.getId(), ACTOR_ID, workflow.getName(), workflow.getDescription(),
                connectedDefinition(connectionId, "initial"), Map.of());

        ExecutorService executor = Executors.newFixedThreadPool(2);
        authorizationGate.arm(2);
        try {
            Future<WorkflowPublicationService.Publication> first = executor.submit(
                    () -> publicationService.publish(workspaceId, workflow.getId(), ACTOR_ID));
            Future<WorkflowPublicationService.Publication> second = executor.submit(
                    () -> publicationService.publish(workspaceId, workflow.getId(), ACTOR_ID));
            assertTrue(authorizationGate.awaitArrival(Duration.ofSeconds(15)),
                    "both publishers must finish remote attachment authorization before locking");
            authorizationGate.release();

            WorkflowPublicationService.Publication firstPublication = first.get(30, TimeUnit.SECONDS);
            WorkflowPublicationService.Publication secondPublication = second.get(30, TimeUnit.SECONDS);
            List<WorkflowPublicationService.Publication> publications = List.of(firstPublication, secondPublication)
                    .stream().sorted(java.util.Comparator.comparingInt(WorkflowPublicationService.Publication::version))
                    .toList();

            assertEquals(List.of(1, 2), publications.stream()
                    .map(WorkflowPublicationService.Publication::version).toList());
            Workflow published = workflows.findByWorkspaceAndId(workspaceId, workflow.getId()).orElseThrow();
            assertEquals(publications.getLast().versionId(), published.getCurrentVersionId());
            assertEquals(WorkflowStatus.PUBLISHED, published.getStatus());

            UUID queuedExecutionId = UUID.randomUUID();
            UUID pinnedVersionId = publications.getFirst().versionId();
            jdbcTemplate.update("insert into workflow.workflow_executions "
                            + "(id, workflow_id, workflow_version_id, status, trigger_type, triggered_by) "
                            + "values (?, ?, ?, 'QUEUED', 'MANUAL', ?)",
                    queuedExecutionId, workflow.getId(), pinnedVersionId, ACTOR_ID);

            draftService.save(workspaceId, workflow.getId(), ACTOR_ID, "Edited after publication", "Description",
                    connectedDefinition(connectionId, "later"), Map.of("viewport", Map.of("zoom", 2)));
            WorkflowPublicationService.Publication third =
                    publicationService.publish(workspaceId, workflow.getId(), ACTOR_ID);

            assertEquals(3, third.version());
            assertEquals(pinnedVersionId, jdbcTemplate.queryForObject(
                    "select workflow_version_id from workflow.workflow_executions where id = ?",
                    UUID.class,
                    queuedExecutionId));
            WorkflowVersion oldSnapshot = versions.require(pinnedVersionId);
            assertEquals("initial", ((Map<?, ?>) oldSnapshot.getDefinition().get("variables")).get("revision"));
            assertEquals("later", ((Map<?, ?>) versions.require(third.versionId()).getDefinition()
                    .get("variables")).get("revision"));
        } finally {
            authorizationGate.release();
            executor.shutdownNow();
            assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS));
        }
    }

    @Test
    void draftSavedDuringRemoteAuthorizationIsNeverPublishedWithoutValidation() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID connectionId = UUID.fromString("30000000-0000-0000-0000-000000000062");
        Workflow workflow = createDraft(workspaceId, "Save/publish race");
        draftService.save(workspaceId, workflow.getId(), ACTOR_ID, workflow.getName(), workflow.getDescription(),
                connectedDefinition(connectionId, "before"), Map.of());

        ExecutorService executor = Executors.newSingleThreadExecutor();
        authorizationGate.arm();
        try {
            Future<WorkflowPublicationService.Publication> publishing = executor.submit(
                    () -> publicationService.publish(workspaceId, workflow.getId(), ACTOR_ID));
            assertTrue(authorizationGate.awaitArrival(Duration.ofSeconds(15)),
                    "publisher must wait outside the workflow row lock during Workspace authorization");

            draftService.save(workspaceId, workflow.getId(), ACTOR_ID, "Changed draft", "Updated description",
                    connectedDefinition(connectionId, "after"), Map.of());
            authorizationGate.release();

            ExecutionException failure = assertThrows(ExecutionException.class,
                    () -> publishing.get(30, TimeUnit.SECONDS));
            assertInstanceOf(DraftChangedException.class, failure.getCause());
            Workflow saved = workflows.findByWorkspaceAndId(workspaceId, workflow.getId()).orElseThrow();
            assertEquals("Changed draft", saved.getName());
            assertEquals("after", ((Map<?, ?>) saved.getDraftDefinition().get("variables")).get("revision"));
            assertEquals(0, versionCount(workflow.getId()));
            assertNull(saved.getCurrentVersionId());
            assertEquals(WorkflowStatus.DRAFT, saved.getStatus());
        } finally {
            authorizationGate.release();
            executor.shutdownNow();
            assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS));
        }
    }

    @Test
    void failureAfterVersionAndTriggerWritesRollsBackTheWholePublication() {
        UUID workspaceId = UUID.randomUUID();
        Workflow workflow = createDraft(workspaceId, "Rollback publication");
        UUID workflowId = workflow.getId();

        workflow.updateDraft(workflow.getName(), workflow.getDescription(), webhookDefinition(), Map.of());
        workflow = workflows.save(workflow);
        WorkflowVersion existingVersion = WorkflowVersion.createNew(workflow.getId(), 1,
                workflow.getDraftDefinition(), workflow.getSchemaVersion(), ACTOR_ID);
        versions.insert(existingVersion);
        Instant originalPublishedAt = Instant.parse("2026-09-20T12:00:00Z");
        workflow.publishVersion(existingVersion.getId(), originalPublishedAt);
        workflow = workflows.save(workflow);
        WorkflowTrigger existingTrigger = WorkflowTrigger.createNew(workflow.getId(), existingVersion.getId(),
                "webhook", TriggerType.WEBHOOK, Map.of());
        triggers.replaceCurrent(workflow.getId(), existingVersion.getId(), List.of(existingTrigger));

        workflow.updateDraft(workflow.getName(), workflow.getDescription(), simpleDefinition("manual-only"), Map.of());
        workflows.save(workflow);
        rollbackInjector.arm();

        assertThrows(WorkflowPublicationTestConfiguration.InjectedPublicationRollbackException.class,
                () -> publicationService.publish(workspaceId, workflowId, ACTOR_ID));

        Workflow restored = workflows.findByWorkspaceAndId(workspaceId, workflowId).orElseThrow();
        assertEquals(WorkflowStatus.PUBLISHED, restored.getStatus());
        assertEquals(existingVersion.getId(), restored.getCurrentVersionId());
        assertEquals(originalPublishedAt, restored.getPublishedAt());
        assertEquals(1, versionCount(workflowId));
        Integer triggerCount = jdbcTemplate.queryForObject(
                "select count(*) from workflow.workflow_triggers where workflow_id = ?", Integer.class, workflowId);
        assertEquals(1, triggerCount);
        String triggerStatus = jdbcTemplate.queryForObject(
                "select status from workflow.workflow_triggers where id = ?", String.class, existingTrigger.getId());
        assertEquals(TriggerStatus.ACTIVE.name(), triggerStatus);
        assertEquals(1, rollbackInjector.disabledTriggerCountBeforeFailure());
    }

    private Workflow createDraft(UUID workspaceId, String name) {
        Workflow workflow = Workflow.createDraft(workspaceId, name, "Publication test", ACTOR_ID);
        return workflows.save(workflow);
    }

    private int versionCount(UUID workflowId) {
        return jdbcTemplate.queryForObject(
                "select count(*) from workflow.workflow_versions where workflow_id = ?", Integer.class, workflowId);
    }

    private WorkflowDefinition connectedDefinition(UUID connectionId, String revision) {
        Map<String, Object> requestConfig = new LinkedHashMap<>();
        requestConfig.put("method", "GET");
        requestConfig.put("url", "https://example.test");
        requestConfig.put("connectionId", connectionId.toString());
        Map<String, Object> variables = Map.of("revision", revision);
        return new WorkflowDefinition("1.0", List.of(
                new WorkflowDefinition.Node("manual", "trigger.manual", Map.of()),
                new WorkflowDefinition.Node("request", "http.request", requestConfig)),
                List.of(new WorkflowDefinition.Edge("manual-to-request", "manual", "request", null)), variables);
    }

    private Map<String, Object> webhookDefinition() {
        Map<String, Object> manual = Map.of("id", "manual", "type", "trigger.manual", "config", Map.of());
        Map<String, Object> webhook = Map.of("id", "webhook", "type", "trigger.webhook", "config", Map.of());
        return Map.of("schemaVersion", "1.0", "nodes", List.of(manual, webhook),
                "edges", List.of(), "variables", Map.of());
    }

    private Map<String, Object> simpleDefinition(String revision) {
        return Map.of("schemaVersion", "1.0",
                "nodes", List.of(Map.of("id", "manual", "type", "trigger.manual", "config", Map.of())),
                "edges", List.of(), "variables", Map.of("revision", revision));
    }
}
