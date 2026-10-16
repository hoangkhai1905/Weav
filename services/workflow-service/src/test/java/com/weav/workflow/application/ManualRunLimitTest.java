package com.weav.workflow.application;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.exception.ManualRunLimitExceededException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** G3: manual admissions are capped per workflow while earlier runs are still active. */
@SpringBootTest(properties = {
        "weav.workflow.execution-outbox.initial-delay=3600000",
        "weav.workflow.execution-outbox.poll-interval=3600000",
        "weav.workflow.execution.manual-active-run-limit=2"
})
@Import(WorkflowPublicationTestConfiguration.class)
class ManualRunLimitTest {

    private static final UUID ACTOR_ID = UUID.fromString("20000000-0000-0000-0000-000000000092");
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
    private JdbcTemplate jdbc;
    @Autowired
    private WorkflowPublicationTestConfiguration.PublicationWorkspaceAccess workspaceAccess;

    @BeforeEach
    void allowEverything() {
        workspaceAccess.setCapabilities(ALL_CAPABILITIES);
    }

    @AfterEach
    void restore() {
        workspaceAccess.reset();
    }

    @Test
    void manualRunsAboveTheActiveLimitAreRefusedUntilOneFinishes() {
        UUID workspaceId = UUID.randomUUID();
        Workflow workflow = publishedManualWorkflow(workspaceId);
        var first = admissionService.manual(workspaceId, workflow.getId(), ACTOR_ID, Map.of(), null, null,
                "cap-key-0001");
        admissionService.manual(workspaceId, workflow.getId(), ACTOR_ID, Map.of(), null, null, null);

        ManualRunLimitExceededException refused = assertThrows(ManualRunLimitExceededException.class,
                () -> admissionService.manual(workspaceId, workflow.getId(), ACTOR_ID, Map.of(), null, null, null));
        assertEquals("MANUAL_RUN_LIMIT_EXCEEDED", refused.getCode());
        assertEquals(2, executionCount(workflow.getId()));

        // An idempotent replay of an admitted run is not a new run and still succeeds at the cap.
        assertEquals(first, admissionService.manual(workspaceId, workflow.getId(), ACTOR_ID, Map.of(), null, null,
                "cap-key-0001"));

        jdbc.update("update workflow.workflow_executions set status = 'SUCCESS', finished_at = now() where id = ?",
                first.executionId());
        admissionService.manual(workspaceId, workflow.getId(), ACTOR_ID, Map.of(), null, null, null);
        assertEquals(3, executionCount(workflow.getId()));
    }

    @Test
    void activeAutomaticRunsDoNotBlockAManualRun() {
        UUID workspaceId = UUID.randomUUID();
        Workflow workflow = publishedManualWorkflow(workspaceId);
        UUID versionId = jdbc.queryForObject("select current_version_id from workflow.workflows where id = ?",
                UUID.class, workflow.getId());
        String[] types = {"SCHEDULE", "WEBHOOK"};
        String[] statuses = {"QUEUED", "RUNNING", "WAITING"};
        for (int i = 0; i < 10; i++) {
            jdbc.update("insert into workflow.workflow_executions (id, workflow_id, workflow_version_id, status, "
                    + "trigger_type) values (?, ?, ?, ?, ?)", UUID.randomUUID(), workflow.getId(), versionId,
                    statuses[i % 3], types[i % 2]);
        }

        admissionService.manual(workspaceId, workflow.getId(), ACTOR_ID, Map.of(), null, null, null);
        assertEquals(11, executionCount(workflow.getId()));
    }

    private int executionCount(UUID workflowId) {
        return jdbc.queryForObject("select count(*) from workflow.workflow_executions where workflow_id = ?",
                Integer.class, workflowId);
    }

    private Workflow publishedManualWorkflow(UUID workspaceId) {
        Workflow draft = draftService.create(new CreateWorkflowCommand(workspaceId, ACTOR_ID, "Manual cap", null));
        draftService.save(workspaceId, draft.getId(), ACTOR_ID, "Manual cap", null,
                new WorkflowDefinition("1.0", List.of(
                        new WorkflowDefinition.Node("manual-root", "trigger.manual", Map.of())),
                        List.of(), Map.of()), Map.of());
        publicationService.publish(workspaceId, draft.getId(), ACTOR_ID);
        return workflows.findByWorkspaceAndId(workspaceId, draft.getId()).orElseThrow();
    }
}
