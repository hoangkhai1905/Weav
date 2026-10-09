package com.weav.workflow.application.trigger;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.port.out.ControlBotStore;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import com.weav.workflow.application.service.WorkflowDraftValidationException;
import com.weav.workflow.application.service.WorkflowEventTriggerService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** trigger.workflow_event and the control-bot reads against real PostgreSQL. */
@SpringBootTest(properties = {
        "weav.workflow.gmail.poller.enabled=false",
        "weav.workflow.schedule.scanner.enabled=false",
        "weav.workflow.web-base-url=https://app.example.test"})
@Import(WorkflowPublicationTestConfiguration.class)
class WorkflowEventIntegrationTest {

    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000071");

    @Autowired
    private WorkflowRepository workflows;
    @Autowired
    private WorkflowPublicationService publication;
    @Autowired
    private ExecutionAdmissionService admissions;
    @Autowired
    private WorkflowEventTriggerService eventTrigger;
    @Autowired
    private ControlBotStore store;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private WorkflowPublicationTestConfiguration.PublicationWorkspaceAccess workspaceAccess;

    private UUID workspaceId;

    @BeforeEach
    void setUp() {
        workspaceId = UUID.randomUUID();
        workspaceAccess.setCapabilities(Set.of("WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT", "WORKFLOW_PUBLISH",
                "WORKFLOW_MANAGE_STATE", "WORKFLOW_RUN"));
    }

    private Workflow publish(String name, Map<String, Object> trigger) {
        Workflow workflow = workflows.save(Workflow.createDraft(workspaceId, name, "d", USER_ID));
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("schemaVersion", "1.0");
        definition.put("nodes", new ArrayList<>(List.of(trigger)));
        definition.put("edges", List.of());
        definition.put("variables", Map.of());
        workflow.updateDraft(workflow.getName(), workflow.getDescription(), definition, Map.of());
        workflows.save(workflow);
        publication.publish(workspaceId, workflow.getId(), USER_ID);
        return workflow;
    }

    private Workflow source(String name) {
        return publish(name, Map.of("id", "manual", "type", "trigger.manual", "config", Map.of()));
    }

    private Workflow watcher(String name, List<String> events, List<String> watched) {
        return publish(name, Map.of("id", "event", "type", "trigger.workflow_event",
                "config", Map.of("events", events, "workflowIds", watched)));
    }

    private UUID run(Workflow workflow) {
        return admissions.manual(workspaceId, workflow.getId(), USER_ID, Map.of(), null, null).executionId();
    }

    private void finish(UUID executionId, String status) {
        jdbc.update("update workflow.workflow_executions set status = ?, started_at = now() - interval '2 seconds', "
                + "finished_at = now(), error = case when ? = 'FAILED' then '{\"code\":\"HTTP_TIMEOUT\","
                + "\"message\":\"timed out\"}'::jsonb else null end where id = ?", status, status, executionId);
    }

    private List<Map<String, Object>> eventRuns(Workflow listener) {
        return jdbc.queryForList("select id, trigger_type, idempotency_key, input::text as input, "
                + "(select trigger_node_id from workflow.workflow_triggers t where t.id = e.trigger_id) as node "
                + "from workflow.workflow_executions e where workflow_id = ?", listener.getId());
    }

    @Test
    void aFailedRunStartsTheListenerOnceWithTheDocumentedInput() {
        Workflow failing = source("Báo cáo tuần");
        Workflow alert = watcher("Alert", List.of("FAILED"), List.of());
        Workflow other = watcher("Only succeeded", List.of("SUCCEEDED"), List.of());
        Workflow unrelated = source("Unrelated");
        Workflow foreignWatch = watcher("Watches another", List.of("FAILED"), List.of(unrelated.getId().toString()));
        UUID execution = run(failing);
        finish(execution, "FAILED");

        eventTrigger.onExecutionFinished(execution);
        eventTrigger.onExecutionFinished(execution); // a duplicate finish notification

        List<Map<String, Object>> runs = eventRuns(alert);
        assertEquals(1, runs.size());
        assertEquals("WORKFLOW_EVENT", runs.getFirst().get("trigger_type"));
        assertEquals("wfevent:" + execution, runs.getFirst().get("idempotency_key"));
        assertEquals("event", runs.getFirst().get("node"));
        String input = (String) runs.getFirst().get("input");
        assertTrue(input.contains("\"HTTP_TIMEOUT\"") && input.contains("\"FAILED\"")
                && input.contains("https://app.example.test/executions/" + execution), input);
        assertEquals(0, eventRuns(other).size());
        assertEquals(0, eventRuns(foreignWatch).size());
        assertEquals(0, eventRuns(failing).stream().filter(r -> "WORKFLOW_EVENT".equals(r.get("trigger_type"))).count());
    }

    @Test
    void theAlertWorkflowItselfFailingDoesNotFireWorkflowEvents() {
        Workflow failing = source("Report");
        Workflow alert = watcher("Alert", List.of("FAILED"), List.of());
        Workflow secondAlert = watcher("Second alert", List.of("FAILED"), List.of());
        UUID execution = run(failing);
        finish(execution, "FAILED");
        eventTrigger.onExecutionFinished(execution);
        UUID alertRun = (UUID) eventRuns(alert).getFirst().get("id");

        finish(alertRun, "FAILED");
        eventTrigger.onExecutionFinished(alertRun);

        assertEquals(1, eventRuns(alert).size());
        assertEquals(1, eventRuns(secondAlert).size(), "only the original failure fired it");
    }

    @Test
    void cancelledRunsAndPausedListenersDoNotFire() {
        Workflow failing = source("Report");
        Workflow alert = watcher("Alert", List.of("FAILED"), List.of());
        Workflow paused = watcher("Paused alert", List.of("FAILED"), List.of());
        publication.pause(workspaceId, paused.getId(), USER_ID);
        UUID cancelled = run(failing);
        finish(cancelled, "CANCELLED");
        eventTrigger.onExecutionFinished(cancelled);
        assertEquals(0, eventRuns(alert).size());

        UUID failed = run(failing);
        finish(failed, "FAILED");
        eventTrigger.onExecutionFinished(failed);
        assertEquals(1, eventRuns(alert).size());
        assertEquals(0, eventRuns(paused).size());
    }

    @Test
    void publishingRejectsAWatchedWorkflowOfAnotherWorkspace() {
        Workflow foreign = workflows.save(Workflow.createDraft(UUID.randomUUID(), "Elsewhere", "d", USER_ID));
        Workflow workflow = workflows.save(Workflow.createDraft(workspaceId, "Watcher", "d", USER_ID));
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("schemaVersion", "1.0");
        definition.put("nodes", new ArrayList<>(List.of(Map.of("id", "event", "type", "trigger.workflow_event",
                "config", Map.of("events", List.of("FAILED"), "workflowIds", List.of(foreign.getId().toString()))))));
        definition.put("edges", List.of());
        definition.put("variables", Map.of());
        workflow.updateDraft(workflow.getName(), workflow.getDescription(), definition, Map.of());
        workflows.save(workflow);

        WorkflowDraftValidationException rejection = assertThrows(WorkflowDraftValidationException.class,
                () -> publication.publish(workspaceId, workflow.getId(), USER_ID));
        assertTrue(rejection.issues().stream().anyMatch(i -> "WORKFLOW_NOT_IN_WORKSPACE".equals(i.code())));
    }

    @Test
    void controlBotReadsReturnTheRunOriginWorkflowsAndStats() {
        Workflow report = source("Báo cáo tuần");
        UUID ok = run(report);
        finish(ok, "SUCCESS");
        UUID bad = run(report);
        finish(bad, "FAILED");

        ControlBotStore.RunOrigin origin = store.runOrigin(bad).orElseThrow();
        assertEquals(USER_ID, origin.publishedBy());
        assertEquals(report.getId(), origin.workflowId());
        assertEquals(workspaceId, origin.workspaceId());
        assertEquals(List.of("Báo cáo tuần"), store.workflows(workspaceId).stream().map(ControlBotStore.WorkflowRef::name).toList());
        assertEquals(Set.of(report.getId()), store.existingWorkflowIds(workspaceId, Set.of(report.getId(), UUID.randomUUID())));
        assertEquals(0.5, store.successRate(report.getId(), Instant.now().minusSeconds(3600)));
        assertNotNull(store.lastFinishedRun(report.getId()).orElseThrow().finishedAt());
        assertEquals(0, store.eventListeners(workspaceId).size());
    }
}
