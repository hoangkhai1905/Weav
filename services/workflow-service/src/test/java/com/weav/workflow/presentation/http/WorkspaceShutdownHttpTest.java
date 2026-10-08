package com.weav.workflow.presentation.http;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.infrastructure.security.InternalServiceKeyFilter;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** W6-D2: the Workspace-only pause-all route, against real PostgreSQL. */
@SpringBootTest(properties = {
        "weav.workflow.execution-outbox.initial-delay=3600000",
        "weav.workflow.execution-outbox.poll-interval=3600000"
})
@Import(WorkflowPublicationTestConfiguration.class)
class WorkspaceShutdownHttpTest {

    private static final String SERVICE_KEY = "workflow-test-internal-service-key";
    private static final UUID ACTOR_ID = UUID.fromString("20000000-0000-0000-0000-000000000d02");

    @Autowired
    private WebApplicationContext webApplicationContext;
    @Autowired
    private WorkflowDraftService draftService;
    @Autowired
    private WorkflowPublicationService publicationService;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private WorkflowPublicationTestConfiguration.PublicationWorkspaceAccess workspaceAccess;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        workspaceAccess.setCapabilities(Set.of("WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT",
                "WORKFLOW_PUBLISH", "WORKFLOW_MANAGE_STATE"));
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
    }

    @AfterEach
    void tearDown() {
        workspaceAccess.reset();
    }

    @Test
    void rejectsCallsWithoutTheServiceKeyAndOtherMethods() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID workflowId = publishedWebhookWorkflow(workspaceId, "No key");
        String path = pausePath(workspaceId);

        mockMvc.perform(post(path).servletPath(path))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
        mockMvc.perform(post(path).servletPath(path).header(InternalServiceKeyFilter.HEADER_NAME, "wrong-key"))
                .andExpect(status().isUnauthorized());
        // GET is not the pause-all method: it falls through to JWT authentication and is refused.
        mockMvc.perform(get(path).servletPath(path).header(InternalServiceKeyFilter.HEADER_NAME, SERVICE_KEY))
                .andExpect(status().isUnauthorized());

        assertEquals("PUBLISHED", workflowStatus(workflowId));
        assertEquals(1, activeTriggers(workflowId));
    }

    @Test
    void pausesOnlyThatWorkspaceDisablesTriggersAndIsIdempotent() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID otherWorkspaceId = UUID.randomUUID();
        UUID first = publishedWebhookWorkflow(workspaceId, "First");
        UUID second = publishedWebhookWorkflow(workspaceId, "Second");
        UUID untouched = publishedWebhookWorkflow(otherWorkspaceId, "Other workspace");
        UUID draftOnly = draftService.create(new CreateWorkflowCommand(workspaceId, ACTOR_ID, "Draft", null)).getId();
        publicationService.pause(workspaceId, second, ACTOR_ID); // already paused before the shutdown

        pauseAll(workspaceId)
                .andExpect(status().isOk())
                .andExpect(content().json(
                        "{\"paused\":1,\"alreadyPaused\":1,\"failedTelegramUnregister\":0,\"failed\":0}", true));

        assertEquals("PAUSED", workflowStatus(first));
        assertEquals("PAUSED", workflowStatus(second));
        assertEquals("DRAFT", workflowStatus(draftOnly));
        assertEquals(0, activeTriggers(first));
        assertEquals(0, activeTriggers(second));
        assertEquals("PUBLISHED", workflowStatus(untouched));
        assertEquals(1, activeTriggers(untouched));
        assertEquals(0, jdbc.queryForObject("select count(*) from workflow.notification_outbox "
                + "where entity_id = ? and event_type = 'workflow.paused'", Integer.class, first),
                "no per-workflow workflow.paused notification for a workspace shutdown");

        // Retry: nothing left to do, same end state.
        pauseAll(workspaceId)
                .andExpect(status().isOk())
                .andExpect(content().json(
                        "{\"paused\":0,\"alreadyPaused\":2,\"failedTelegramUnregister\":0,\"failed\":0}", true));
        assertEquals("PUBLISHED", workflowStatus(untouched));
    }

    private ResultActions pauseAll(UUID workspaceId) throws Exception {
        String path = pausePath(workspaceId);
        return mockMvc.perform(post(path).servletPath(path).header(InternalServiceKeyFilter.HEADER_NAME, SERVICE_KEY));
    }

    private UUID publishedWebhookWorkflow(UUID workspaceId, String name) {
        Workflow workflow = draftService.create(new CreateWorkflowCommand(workspaceId, ACTOR_ID, name, null));
        draftService.save(workspaceId, workflow.getId(), ACTOR_ID, name, null,
                new WorkflowDefinition("1.0", List.of(
                        new WorkflowDefinition.Node("manual", "trigger.manual", Map.of()),
                        new WorkflowDefinition.Node("webhook", "trigger.webhook", Map.of())),
                        List.of(), Map.of()), Map.of());
        publicationService.publish(workspaceId, workflow.getId(), ACTOR_ID);
        return workflow.getId();
    }

    private String workflowStatus(UUID workflowId) {
        return jdbc.queryForObject("select status from workflow.workflows where id = ?", String.class, workflowId);
    }

    private int activeTriggers(UUID workflowId) {
        return jdbc.queryForObject(
                "select count(*) from workflow.workflow_triggers where workflow_id = ? and status = 'ACTIVE'",
                Integer.class, workflowId);
    }

    private static String pausePath(UUID workspaceId) {
        return "/internal/workspaces/" + workspaceId + "/pause-all";
    }
}
