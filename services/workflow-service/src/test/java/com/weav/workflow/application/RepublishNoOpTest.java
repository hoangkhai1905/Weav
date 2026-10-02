package com.weav.workflow.application;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
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
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** WF-3: republishing an unchanged draft is a no-op; a changed draft publishes a new version. */
@SpringBootTest(properties = {
        "weav.workflow.execution-outbox.initial-delay=3600000",
        "weav.workflow.execution-outbox.poll-interval=3600000"
})
@Import(WorkflowPublicationTestConfiguration.class)
class RepublishNoOpTest {

    private static final UUID ACTOR_ID = UUID.fromString("20000000-0000-0000-0000-000000000092");

    @Autowired
    private WorkflowDraftService draftService;
    @Autowired
    private WorkflowPublicationService publicationService;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private WorkflowPublicationTestConfiguration.PublicationWorkspaceAccess workspaceAccess;

    @BeforeEach
    void allowEverything() {
        workspaceAccess.setCapabilities(Set.of("WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT",
                "WORKFLOW_PUBLISH", "WORKFLOW_MANAGE_STATE"));
    }

    @AfterEach
    void restore() {
        workspaceAccess.reset();
    }

    @Test
    void unchangedRepublishKeepsVersionWebhookAndEventsAndChangedDraftRotatesThem() {
        UUID workspaceId = UUID.randomUUID();
        Workflow workflow = draftService.create(new CreateWorkflowCommand(workspaceId, ACTOR_ID, "Republish", null));
        UUID workflowId = workflow.getId();
        draftService.save(workspaceId, workflowId, ACTOR_ID, "Republish", null, definition("one"), Map.of());

        var first = publicationService.publish(workspaceId, workflowId, ACTOR_ID);
        assertEquals(1, first.version());
        assertEquals(1, first.webhooks().size());
        String endpointKey = first.webhooks().getFirst().endpointKey();
        String secretHash = jdbc.queryForObject(
                "select secret_hash from workflow.workflow_triggers where workflow_id = ? and status = 'ACTIVE'",
                String.class, workflowId);

        var second = publicationService.publish(workspaceId, workflowId, ACTOR_ID);

        assertEquals(first.versionId(), second.versionId());
        assertEquals(1, second.version());
        assertEquals(first.status(), second.status());
        assertTrue(second.webhooks().isEmpty(), "the one-time secret must not be returned again");
        assertEquals(1, count("select count(*) from workflow.workflow_versions where workflow_id = ?", workflowId));
        assertEquals(1, count("select count(*) from workflow.workflow_triggers where workflow_id = ?", workflowId));
        assertEquals(endpointKey, jdbc.queryForObject(
                "select endpoint_key from workflow.workflow_triggers where workflow_id = ? and status = 'ACTIVE'",
                String.class, workflowId));
        assertEquals(secretHash, jdbc.queryForObject(
                "select secret_hash from workflow.workflow_triggers where workflow_id = ? and status = 'ACTIVE'",
                String.class, workflowId));
        assertEquals(1, count("select count(*) from workflow.notification_outbox "
                + "where entity_id = ? and event_type = 'workflow.published'", workflowId));

        draftService.save(workspaceId, workflowId, ACTOR_ID, "Republish", null, definition("two"), Map.of());
        var third = publicationService.publish(workspaceId, workflowId, ACTOR_ID);

        assertEquals(2, third.version());
        assertNotEquals(first.versionId(), third.versionId());
        assertEquals(1, third.webhooks().size());
        assertNotEquals(endpointKey, third.webhooks().getFirst().endpointKey());
        assertFalse(third.webhooks().getFirst().secret().isBlank());
        assertEquals(2, count("select count(*) from workflow.workflow_versions where workflow_id = ?", workflowId));
        assertEquals(2, count("select count(*) from workflow.notification_outbox "
                + "where entity_id = ? and event_type = 'workflow.published'", workflowId));
    }

    private int count(String sql, UUID id) {
        return jdbc.queryForObject(sql, Integer.class, id);
    }

    private WorkflowDefinition definition(String revision) {
        return new WorkflowDefinition("1.0", List.of(
                new WorkflowDefinition.Node("manual", "trigger.manual", Map.of()),
                new WorkflowDefinition.Node("webhook", "trigger.webhook", Map.of())),
                List.of(), Map.of("revision", revision));
    }
}
