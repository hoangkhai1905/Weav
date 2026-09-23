package com.weav.workflow.application;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.application.port.out.WorkflowVersionPort;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.domain.exception.InvalidStateException;
import com.weav.workflow.domain.exception.ResourceNotFoundException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowVersion;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowTriggerJpaEntity;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowVersionJpaEntity;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** PostgreSQL-backed admission, isolation, immutable-input, and atomicity checks. */
@SpringBootTest(properties = {
        "weav.workflow.execution-outbox.initial-delay=3600000",
        "weav.workflow.execution-outbox.poll-interval=3600000"
})
@Import(WorkflowPublicationTestConfiguration.class)
class ExecutionAdmissionTest {

    private static final UUID ACTOR_ID = UUID.fromString("20000000-0000-0000-0000-000000000081");
    private static final Set<String> ALL_CAPABILITIES = Set.of(
            "WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT", "WORKFLOW_PUBLISH",
            "WORKFLOW_RUN", "WORKFLOW_MANAGE_STATE");

    @Autowired
    private ExecutionAdmissionService admissionService;
    @Autowired
    private WorkflowDraftService draftService;
    @Autowired
    private WorkflowPublicationService publicationService;
    @Autowired
    private WorkflowRepository workflows;
    @Autowired
    private WorkflowVersionPort versions;
    @Autowired
    private WorkflowTriggerPort triggers;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private EntityManager entityManager;
    @Autowired
    private WorkflowPublicationTestConfiguration.PublicationWorkspaceAccess workspaceAccess;

    @BeforeEach
    void allowWorkflowSetupAndManualRun() {
        workspaceAccess.setCapabilities(ALL_CAPABILITIES);
    }

    @AfterEach
    void restoreWorkspaceAccess() {
        workspaceAccess.reset();
    }

    @Test
    void manualAdmissionPinsTheCurrentVersionAndPersistsTheExactRootAndFrozenObjectInput() {
        UUID workspaceId = UUID.randomUUID();
        Workflow workflow = createPublishedManualWorkflow(workspaceId, "operator-selected-manual-root");
        UUID firstVersionId = workflows.findByWorkspaceAndId(workspaceId, workflow.getId()).orElseThrow()
                .getCurrentVersionId();

        Map<String, Object> nested = new LinkedHashMap<>();
        nested.put("explicitNull", null);
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("nested", nested);
        var admission = admissionService.manual(workspaceId, workflow.getId(), ACTOR_ID,
                input, "admission-test-01", null);
        nested.put("mutatedAfterAdmission", true);

        assertEquals(ExecutionStatus.QUEUED, admission.status());
        assertEquals(firstVersionId, admission.workflowVersionId());
        assertEquals("operator-selected-manual-root", jdbc.queryForObject(
                "select root_node_id from workflow.workflow_executions where id = ?", String.class,
                admission.executionId()));
        assertNull(jdbc.queryForObject(
                "select trigger_id from workflow.workflow_executions where id = ?", UUID.class,
                admission.executionId()));
        assertEquals("admission-test-01", jdbc.queryForObject(
                "select correlation_id from workflow.workflow_executions where id = ?", String.class,
                admission.executionId()));
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.node_executions where execution_id = ?", Integer.class,
                admission.executionId()));
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.outbox_events where aggregate_id = ? and status = 'PENDING'",
                Integer.class, admission.executionId()));
        String inputJson = jdbc.queryForObject(
                "select input::text from workflow.workflow_executions where id = ?", String.class,
                admission.executionId());
        assertTrue(inputJson.contains("\"explicitNull\": null") || inputJson.contains("\"explicitNull\":null"));
        assertFalse(inputJson.contains("mutatedAfterAdmission"));

        Workflow current = workflows.findByWorkspaceAndId(workspaceId, workflow.getId()).orElseThrow();
        draftService.save(workspaceId, workflow.getId(), ACTOR_ID, workflow.getName(), workflow.getDescription(),
                manualDefinition("operator-selected-manual-root", "edited-after-run"), Map.of());
        WorkflowPublicationService.Publication next = publicationService.publish(workspaceId, workflow.getId(), ACTOR_ID);
        assertFalse(firstVersionId.equals(next.versionId()));
        assertEquals(firstVersionId, jdbc.queryForObject(
                "select workflow_version_id from workflow.workflow_executions where id = ?", UUID.class,
                admission.executionId()));
        assertEquals(WorkflowStatus.PUBLISHED, current.getStatus());
    }

    @Test
    void manualAdmissionRequiresWorkspaceRunCapabilityAndRejectsDraftPausedAndForeignWorkflows() {
        UUID workspaceId = UUID.randomUUID();
        Workflow draft = createDraft(workspaceId, "draft-manual-root");

        assertThrows(InvalidStateException.class, () -> admissionService.manual(
                workspaceId, draft.getId(), ACTOR_ID, Map.of(), null, null));

        Workflow published = createPublishedManualWorkflow(workspaceId, "published-manual-root");
        workspaceAccess.setCapabilities(Set.of("WORKFLOW_CREATE", "WORKFLOW_EDIT", "WORKFLOW_PUBLISH"));
        assertThrows(ForbiddenException.class, () -> admissionService.manual(
                workspaceId, published.getId(), ACTOR_ID, Map.of(), null, null));

        workspaceAccess.setCapabilities(ALL_CAPABILITIES);
        publicationService.pause(workspaceId, published.getId(), ACTOR_ID);
        assertThrows(InvalidStateException.class, () -> admissionService.manual(
                workspaceId, published.getId(), ACTOR_ID, Map.of(), null, null));
        assertThrows(ResourceNotFoundException.class, () -> admissionService.manual(
                UUID.randomUUID(), published.getId(), ACTOR_ID, Map.of(), null, null));

        assertEquals(0, jdbc.queryForObject(
                "select count(*) from workflow.workflow_executions where workflow_id in (?, ?)", Integer.class,
                draft.getId(), published.getId()));
    }

    @Test
    void manualRequiresAnObjectAndAutomaticInputsRespectSizeAndDepthLimits() {
        UUID workspaceId = UUID.randomUUID();
        Workflow workflow = createPublishedManualWorkflow(workspaceId, "bounded-manual-root");
        assertThrows(BadRequestException.class, () -> admissionService.manual(
                workspaceId, workflow.getId(), ACTOR_ID, List.of("must remain an object"), null, null));

        List<Object> tooDeep = new ArrayList<>();
        List<Object> cursor = tooDeep;
        for (int index = 0; index < 40; index++) {
            List<Object> child = new ArrayList<>();
            cursor.add(child);
            cursor = child;
        }
        assertThrows(BadRequestException.class, () -> admissionService.automatic(
                UUID.randomUUID(), tooDeep, null, null, null));
        assertThrows(BadRequestException.class, () -> admissionService.automatic(
                UUID.randomUUID(), "x".repeat(1_048_577), null, null, null));

        assertEquals(0, jdbc.queryForObject(
                "select count(*) from workflow.workflow_executions where workflow_id = ?", Integer.class,
                workflow.getId()));
    }

    @Test
    void automaticAdmissionUsesTheStoredTriggerRootPreservesArrayInputAndDeduplicatesScheduleSlots() {
        AutomaticFixture webhook = createPublishedAutomaticFixture(TriggerType.WEBHOOK, "webhook-root");
        List<Object> webhookInput = List.of("literal", 7L);
        var webhookAdmission = admissionService.automatic(
                webhook.triggerId(), webhookInput, null, "webhook-correlation", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");

        assertEquals(webhook.workflowId(), webhookAdmission.workflowId());
        assertEquals("webhook-root", jdbc.queryForObject(
                "select root_node_id from workflow.workflow_executions where id = ?", String.class,
                webhookAdmission.executionId()));
        assertEquals(webhook.triggerId(), jdbc.queryForObject(
                "select trigger_id from workflow.workflow_executions where id = ?", UUID.class,
                webhookAdmission.executionId()));
        assertTrue(jdbc.queryForObject(
                "select jsonb_typeof(input) = 'array' from workflow.workflow_executions where id = ?",
                Boolean.class, webhookAdmission.executionId()));
        assertEquals("WEBHOOK", jdbc.queryForObject(
                "select trigger_type from workflow.workflow_executions where id = ?", String.class,
                webhookAdmission.executionId()));

        var scalarAdmission = admissionService.automatic(
                webhook.triggerId(), "literal scalar", null, null, null);
        assertEquals("string", jdbc.queryForObject(
                "select jsonb_typeof(input) from workflow.workflow_executions where id = ?", String.class,
                scalarAdmission.executionId()));
        assertEquals("\"literal scalar\"", jdbc.queryForObject(
                "select input::text from workflow.workflow_executions where id = ?", String.class,
                scalarAdmission.executionId()));
        var nullAdmission = admissionService.automatic(webhook.triggerId(), null, null, null, null);
        assertEquals("null", jdbc.queryForObject(
                "select jsonb_typeof(input) from workflow.workflow_executions where id = ?", String.class,
                nullAdmission.executionId()));

        AutomaticFixture schedule = createPublishedAutomaticFixture(TriggerType.SCHEDULE, "scheduled-root");
        Instant scheduledAt = Instant.parse("2026-09-21T10:15:00Z");
        Map<String, Object> scheduleInput = Map.of("scheduledAt", scheduledAt.toString());
        var first = admissionService.automatic(schedule.triggerId(), scheduleInput, scheduledAt, null, null);
        var duplicate = admissionService.automatic(schedule.triggerId(), scheduleInput, scheduledAt, null, null);

        assertEquals(first.executionId(), duplicate.executionId());
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.workflow_executions where trigger_id = ? and scheduled_at = ?",
                Integer.class, schedule.triggerId(), Timestamp.from(scheduledAt)));
        assertEquals(3, jdbc.queryForObject(
                "select count(*) from workflow.node_executions where execution_id = ?", Integer.class,
                first.executionId()));
    }

    @Test
    void aDatabaseFailureRollsBackTheExecutionEveryNodeAndTheOutboxIntent() {
        UUID workspaceId = UUID.randomUUID();
        Workflow workflow = createPublishedManualWorkflow(workspaceId, "rollback-root");
        UUID versionId = workflows.findByWorkspaceAndId(workspaceId, workflow.getId()).orElseThrow()
                .getCurrentVersionId();
        String duplicateNodeDefinition = "{\"schemaVersion\":\"1.0\",\"nodes\":["
                + "{\"id\":\"rollback-root\",\"type\":\"trigger.manual\",\"config\":{}},"
                + "{\"id\":\"rollback-root\",\"type\":\"logic.condition\",\"config\":{}}],"
                + "\"edges\":[],\"variables\":{}}";
        jdbc.update("update workflow.workflow_versions set definition = cast(? as jsonb) where id = ?",
                duplicateNodeDefinition, versionId);

        assertThrows(RuntimeException.class, () -> admissionService.manual(
                workspaceId, workflow.getId(), ACTOR_ID, Map.of(), null, null));

        assertEquals(0, jdbc.queryForObject(
                "select count(*) from workflow.workflow_executions where workflow_id = ?", Integer.class,
                workflow.getId()));
        assertEquals(0, jdbc.queryForObject(
                "select count(*) from workflow.node_executions where execution_id in "
                        + "(select id from workflow.workflow_executions where workflow_id = ?)",
                Integer.class, workflow.getId()));
        assertEquals(0, jdbc.queryForObject(
                "select count(*) from workflow.outbox_events where aggregate_type = 'WORKFLOW_EXECUTION' "
                        + "and aggregate_id in (select id from workflow.workflow_executions where workflow_id = ?)",
                Integer.class, workflow.getId()));
    }

    private Workflow createDraft(UUID workspaceId, String rootId) {
        Workflow workflow = draftService.create(new CreateWorkflowCommand(workspaceId, ACTOR_ID, "Admission test", null));
        draftService.save(workspaceId, workflow.getId(), ACTOR_ID, "Admission test", null,
                manualDefinition(rootId, "initial"), Map.of());
        return workflows.findByWorkspaceAndId(workspaceId, workflow.getId()).orElseThrow();
    }

    private Workflow createPublishedManualWorkflow(UUID workspaceId, String rootId) {
        Workflow draft = createDraft(workspaceId, rootId);
        publicationService.publish(workspaceId, draft.getId(), ACTOR_ID);
        return workflows.findByWorkspaceAndId(workspaceId, draft.getId()).orElseThrow();
    }

    private AutomaticFixture createPublishedAutomaticFixture(TriggerType type, String triggerNodeId) {
        UUID workspaceId = UUID.randomUUID();
        Workflow draft = draftService.create(new CreateWorkflowCommand(workspaceId, ACTOR_ID, "Automatic fixture", null));
        WorkflowDefinition definition = new WorkflowDefinition("1.0", List.of(
                new WorkflowDefinition.Node("manual-root", "trigger.manual", Map.of()),
                new WorkflowDefinition.Node(triggerNodeId, "trigger." + type.name().toLowerCase(), Map.of()),
                new WorkflowDefinition.Node("sink", "email.send", Map.of())), List.of(), Map.of());
        draftService.save(workspaceId, draft.getId(), ACTOR_ID, "Automatic fixture", null, definition, Map.of());
        Workflow persistedDraft = workflows.findByWorkspaceAndId(workspaceId, draft.getId()).orElseThrow();
        WorkflowVersion version = WorkflowVersion.createNew(draft.getId(), 1, persistedDraft.getDraftDefinition(),
                "1.0", ACTOR_ID);
        versions.insert(version);
        Workflow current = workflows.lockByWorkspaceAndId(workspaceId, draft.getId()).orElseThrow();
        current.publishVersion(version.getId(), Instant.now());
        workflows.save(current);
        WorkflowTrigger trigger = WorkflowTrigger.createNew(draft.getId(), version.getId(), triggerNodeId,
                type, Map.of());
        triggers.replaceCurrent(draft.getId(), version.getId(), List.of(trigger));
        return new AutomaticFixture(draft.getId(), trigger.getId());
    }

    private WorkflowDefinition manualDefinition(String rootId, String revision) {
        return new WorkflowDefinition("1.0", List.of(
                new WorkflowDefinition.Node(rootId, "trigger.manual", Map.of())),
                List.of(), Map.of("revision", revision));
    }

    private record AutomaticFixture(UUID workflowId, UUID triggerId) {
    }
}
