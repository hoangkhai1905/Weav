package com.weav.workflow.presentation.http;

import com.sun.net.httpserver.HttpServer;
import com.weav.workflow.WorkflowDraftTestConfiguration;
import com.weav.workflow.application.port.out.ConnectionReferencePort;
import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.infrastructure.security.InternalServiceKeyFilter;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@Import(WorkflowDraftTestConfiguration.class)
class ConnectionUsageHttpTest {

    private static final String SERVICE_KEY = "workflow-test-internal-service-key";
    private static final UUID ACTOR_ID = UUID.fromString("22000000-0000-0000-0000-000000000072");
    private static final AtomicInteger WORKSPACE_HTTP_REQUESTS = new AtomicInteger();
    private static final HttpServer WORKSPACE_HTTP_FIXTURE = startWorkspaceHttpFixture();

    private MockMvc mockMvc;

    @Autowired
    private WebApplicationContext webApplicationContext;

    @Autowired
    private WorkflowDraftService workflowDraftService;

    @Autowired
    private WorkflowPublicationService workflowPublicationService;

    @Autowired
    private ConnectionReferencePort connectionReferences;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Autowired
    private WorkflowDraftTestConfiguration.DraftWorkspaceBoundary workspaceBoundary;

    @DynamicPropertySource
    static void workspaceUrl(DynamicPropertyRegistry registry) {
        registry.add("weav.workspace.base-url", () -> "http://127.0.0.1:" + WORKSPACE_HTTP_FIXTURE.getAddress().getPort());
    }

    @BeforeEach
    void resetBoundaryFixture() {
        workspaceBoundary.reset();
        WORKSPACE_HTTP_REQUESTS.set(0);
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
    }

    @AfterAll
    static void stopWorkspaceHttpFixture() {
        WORKSPACE_HTTP_FIXTURE.stop(0);
    }

    @Test
    void requiresTheInternalKeyAndReturnsFalseForNeverObservedPairsWithoutCallingWorkspace() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID connectionId = UUID.randomUUID();
        String path = usagePath(workspaceId, connectionId);

        mockMvc.perform(get(path).servletPath(path))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
        mockMvc.perform(get(path).servletPath(path)
                        .header(InternalServiceKeyFilter.HEADER_NAME, "wrong-key"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
        mockMvc.perform(get(path).servletPath(path)
                        .header(InternalServiceKeyFilter.HEADER_NAME, SERVICE_KEY))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"inUse\":false}", true));

        assertFalse(connectionReferences.inUse(workspaceId, connectionId));
        assertEquals(0, WORKSPACE_HTTP_REQUESTS.get());
    }

    @Test
    void tracksActiveDraftsWithinTheirWorkspaceAndExcludesDeletedDrafts() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID otherWorkspaceId = UUID.randomUUID();
        UUID connectionId = UUID.randomUUID();
        Workflow workflow = saveDraftWithConnection(workspaceId, connectionId);

        getUsage(workspaceId, connectionId)
                .andExpect(status().isOk())
                .andExpect(content().json("{\"inUse\":true}", true));
        getUsage(otherWorkspaceId, connectionId)
                .andExpect(status().isOk())
                .andExpect(content().json("{\"inUse\":false}", true));

        jdbcTemplate.update("update workflow.workflows set deleted_at = ? where id = ?",
                java.sql.Timestamp.from(Instant.parse("2026-09-21T00:00:00Z")), workflow.getId());

        getUsage(workspaceId, connectionId)
                .andExpect(status().isOk())
                .andExpect(content().json("{\"inUse\":false}", true));
        assertEquals(0, WORKSPACE_HTTP_REQUESTS.get());
    }

    @Test
    void draftDefinitionAndReferenceProjectionRollbackTogether() {
        UUID workspaceId = UUID.randomUUID();
        UUID connectionId = UUID.randomUUID();
        Workflow workflow = workflowDraftService.create(
                new com.weav.workflow.application.dto.CreateWorkflowCommand(
                        workspaceId, ACTOR_ID, "Rollback projection", null));

        new TransactionTemplate(transactionManager).executeWithoutResult(transaction -> {
            workflowDraftService.save(workspaceId, workflow.getId(), ACTOR_ID,
                    "Rollback projection", null, definitionWithConnection(connectionId), Map.of());
            assertTrue(connectionReferences.inUse(workspaceId, connectionId));
            transaction.setRollbackOnly();
        });

        assertFalse(connectionReferences.inUse(workspaceId, connectionId));
        assertEquals(0, jdbcTemplate.queryForObject(
                "select count(*) from workflow.workflow_connection_references "
                        + "where workflow_id = ? and version_id is null", Integer.class, workflow.getId()));
    }

    @Test
    void keepsImmutableVersionReferencesAfterDraftEditAndWorkflowSoftDeletion() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID connectionId = UUID.randomUUID();
        workspaceBoundary.setCapabilities(Set.of("WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT",
                "WORKFLOW_PUBLISH"));
        Workflow workflow = workflowDraftService.create(
                new com.weav.workflow.application.dto.CreateWorkflowCommand(
                        workspaceId, ACTOR_ID, "Published connection usage", null));
        workflowDraftService.save(workspaceId, workflow.getId(), ACTOR_ID,
                "Published connection usage", null, publishableDefinitionWithConnection(connectionId), Map.of());
        WorkflowPublicationService.Publication publication =
                workflowPublicationService.publish(workspaceId, workflow.getId(), ACTOR_ID);

        assertEquals(1, publication.version());
        assertEquals(workflow.getId(), publication.workflowId());
        assertTrue(connectionReferences.inUse(workspaceId, connectionId));

        workflowDraftService.save(workspaceId, workflow.getId(), ACTOR_ID,
                "No longer uses the connection", null, definitionWithoutConnection(), Map.of());
        assertTrue(connectionReferences.inUse(workspaceId, connectionId));
        getUsage(workspaceId, connectionId)
                .andExpect(status().isOk())
                .andExpect(content().json("{\"inUse\":true}", true));

        jdbcTemplate.update("update workflow.workflows set deleted_at = ? where id = ?",
                java.sql.Timestamp.from(Instant.parse("2026-09-21T00:00:00Z")), workflow.getId());

        getUsage(workspaceId, connectionId)
                .andExpect(status().isOk())
                .andExpect(content().json("{\"inUse\":true}", true));
        assertEquals(0, WORKSPACE_HTTP_REQUESTS.get());
    }

    @Test
    void databaseFailureUsesTheSafeInternalServerErrorEnvelope() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID connectionId = UUID.randomUUID();
        jdbcTemplate.execute("alter table workflow.workflow_connection_references "
                + "rename to workflow_connection_references_unavailable");
        try {
            var response = getUsage(workspaceId, connectionId)
                    .andExpect(status().isInternalServerError())
                    .andExpect(jsonPath("$.error.code").value("INTERNAL_ERROR"))
                    .andExpect(jsonPath("$.status").value(500))
                    .andReturn()
                    .getResponse()
                    .getContentAsString();
            assertFalse(response.contains("workflow_connection_references"));
        } finally {
            jdbcTemplate.execute("alter table workflow.workflow_connection_references_unavailable "
                    + "rename to workflow_connection_references");
        }
        assertEquals(0, WORKSPACE_HTTP_REQUESTS.get());
    }

    private Workflow saveDraftWithConnection(UUID workspaceId, UUID connectionId) {
        Workflow workflow = workflowDraftService.create(
                new com.weav.workflow.application.dto.CreateWorkflowCommand(
                        workspaceId, ACTOR_ID, "Connection usage", null));
        return workflowDraftService.save(workspaceId, workflow.getId(), ACTOR_ID,
                "Connection usage", null, definitionWithConnection(connectionId), Map.of());
    }

    private WorkflowDefinition definitionWithConnection(UUID connectionId) {
        return new WorkflowDefinition("1.0", List.of(
                new WorkflowDefinition.Node("manual", "trigger.manual", Map.of()),
                new WorkflowDefinition.Node("sheets", "google.sheets",
                        Map.of("connectionId", connectionId.toString()))), List.of(), Map.of());
    }

    private WorkflowDefinition definitionWithoutConnection() {
        return new WorkflowDefinition("1.0",
                List.of(new WorkflowDefinition.Node("manual", "trigger.manual", Map.of())),
                List.of(), Map.of());
    }

    private WorkflowDefinition publishableDefinitionWithConnection(UUID connectionId) {
        return new WorkflowDefinition("1.0", List.of(
                new WorkflowDefinition.Node("manual", "trigger.manual", Map.of()),
                new WorkflowDefinition.Node("request", "http.request", Map.of(
                        "method", "GET",
                        "url", "https://example.test",
                        "connectionId", connectionId.toString()))),
                List.of(new WorkflowDefinition.Edge("manual-to-request", "manual", "request", null)), Map.of());
    }

    private org.springframework.test.web.servlet.ResultActions getUsage(UUID workspaceId, UUID connectionId)
            throws Exception {
        String path = usagePath(workspaceId, connectionId);
        return mockMvc.perform(get(path).servletPath(path)
                .header(InternalServiceKeyFilter.HEADER_NAME, SERVICE_KEY));
    }

    private String usagePath(UUID workspaceId, UUID connectionId) {
        return "/internal/workspaces/" + workspaceId + "/connections/" + connectionId + "/usage";
    }

    private static HttpServer startWorkspaceHttpFixture() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                WORKSPACE_HTTP_REQUESTS.incrementAndGet();
                exchange.sendResponseHeaders(500, -1);
                exchange.close();
            });
            server.start();
            return server;
        } catch (IOException exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }
}
