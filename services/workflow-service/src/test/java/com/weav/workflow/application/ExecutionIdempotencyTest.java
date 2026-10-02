package com.weav.workflow.application;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.exception.IdempotencyKeyReusedException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** WF-1: Idempotency-Key admission against real PostgreSQL. */
@SpringBootTest(properties = {
        "weav.workflow.execution-outbox.initial-delay=3600000",
        "weav.workflow.execution-outbox.poll-interval=3600000"
})
@Import(WorkflowPublicationTestConfiguration.class)
class ExecutionIdempotencyTest {

    private static final UUID ACTOR_ID = UUID.fromString("20000000-0000-0000-0000-000000000091");
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
    void sameKeyTwiceCreatesOneExecutionAndReplaysTheIdenticalAdmission() {
        UUID workspaceId = UUID.randomUUID();
        Workflow workflow = publishedManualWorkflow(workspaceId);
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("b", 2);
        input.put("a", Map.of("y", 1, "x", List.of(1, 2)));

        var first = admissionService.manual(workspaceId, workflow.getId(), ACTOR_ID, input, null, null, "key-0001-abcd");
        // Same JSON content in a different key order is the same request.
        Map<String, Object> reordered = new LinkedHashMap<>();
        reordered.put("a", Map.of("x", List.of(1, 2), "y", 1));
        reordered.put("b", 2);
        var replay = admissionService.manual(workspaceId, workflow.getId(), ACTOR_ID, reordered, null, null, "key-0001-abcd");

        assertEquals(first, replay);
        assertEquals(1, executionCount(workflow.getId()));
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.outbox_events where aggregate_id = ?", Integer.class,
                first.executionId()));
        assertEquals(64, jdbc.queryForObject(
                "select length(request_hash) from workflow.workflow_executions where id = ?", Integer.class,
                first.executionId()));
    }

    @Test
    void sameKeyWithDifferentBodyIsRejectedAndNoSecondExecutionExists() {
        UUID workspaceId = UUID.randomUUID();
        Workflow workflow = publishedManualWorkflow(workspaceId);
        admissionService.manual(workspaceId, workflow.getId(), ACTOR_ID, Map.of("n", 1), null, null, "key-0002-abcd");

        assertThrows(IdempotencyKeyReusedException.class, () -> admissionService.manual(
                workspaceId, workflow.getId(), ACTOR_ID, Map.of("n", 2), null, null, "key-0002-abcd"));

        assertEquals(1, executionCount(workflow.getId()));
    }

    @Test
    void concurrentRequestsWithTheSameKeyCreateExactlyOneExecution() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        Workflow workflow = publishedManualWorkflow(workspaceId);
        int callers = 3; // the Hikari pool is capped at 3
        ExecutorService executor = Executors.newFixedThreadPool(callers);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<UUID>> futures = new ArrayList<>();
            for (int i = 0; i < callers; i++) {
                futures.add(executor.submit(() -> {
                    start.await();
                    return admissionService.manual(workspaceId, workflow.getId(), ACTOR_ID, Map.of("n", 1),
                            null, null, "key-0003-race").executionId();
                }));
            }
            start.countDown();
            List<UUID> ids = new ArrayList<>();
            for (Future<UUID> future : futures) {
                ids.add(future.get(30, TimeUnit.SECONDS));
            }
            assertEquals(1, ids.stream().distinct().count());
            assertEquals(1, executionCount(workflow.getId()));
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void absentKeyKeepsTodaysBehaviourAndMalformedKeysAreBadRequests() {
        UUID workspaceId = UUID.randomUUID();
        Workflow workflow = publishedManualWorkflow(workspaceId);

        var one = admissionService.manual(workspaceId, workflow.getId(), ACTOR_ID, Map.of(), null, null, null);
        var two = admissionService.manual(workspaceId, workflow.getId(), ACTOR_ID, Map.of(), null, null);
        assertNotEquals(one.executionId(), two.executionId());
        assertEquals(2, executionCount(workflow.getId()));

        for (String bad : List.of("short", "has space in it", "x".repeat(129), "bad/char/in-key")) {
            assertThrows(BadRequestException.class, () -> admissionService.manual(
                    workspaceId, workflow.getId(), ACTOR_ID, Map.of(), null, null, bad));
        }
        assertEquals(2, executionCount(workflow.getId()));
    }

    private int executionCount(UUID workflowId) {
        return jdbc.queryForObject("select count(*) from workflow.workflow_executions where workflow_id = ?",
                Integer.class, workflowId);
    }

    private Workflow publishedManualWorkflow(UUID workspaceId) {
        Workflow draft = draftService.create(new CreateWorkflowCommand(workspaceId, ACTOR_ID, "Idempotency", null));
        draftService.save(workspaceId, draft.getId(), ACTOR_ID, "Idempotency", null,
                new WorkflowDefinition("1.0", List.of(
                        new WorkflowDefinition.Node("manual-root", "trigger.manual", Map.of())),
                        List.of(), Map.of()), Map.of());
        publicationService.publish(workspaceId, draft.getId(), ACTOR_ID);
        return workflows.findByWorkspaceAndId(workspaceId, draft.getId()).orElseThrow();
    }
}
