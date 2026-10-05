package com.weav.workflow.application.trigger;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.port.out.GmailMailboxPort;
import com.weav.workflow.application.port.out.GmailTriggerPort;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionOperations;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** trigger.gmail against real PostgreSQL: V11 migration, publish/pause/resume/republish and overlapping polls. */
@SpringBootTest(properties = {
        "weav.workflow.gmail.poller.enabled=false",
        "weav.workflow.schedule.scanner.enabled=false"})
@Import(WorkflowPublicationTestConfiguration.class)
class GmailTriggerIntegrationTest {

    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000071");

    @Autowired
    private WorkflowRepository workflows;
    @Autowired
    private WorkflowPublicationService publication;
    @Autowired
    private com.weav.workflow.application.port.out.WorkflowTriggerPort triggers;
    @Autowired
    private GmailTriggerPort gmailTriggers;
    @Autowired
    private ExecutionAdmissionService admissions;
    @Autowired
    private TransactionOperations transactions;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private WorkflowPublicationTestConfiguration.PublicationWorkspaceAccess workspaceAccess;

    private UUID workspaceId;
    private UUID connection;

    @BeforeEach
    void setUp() {
        workspaceId = UUID.randomUUID();
        connection = UUID.randomUUID();
        workspaceAccess.reset();
    }

    private Workflow draft(String query) {
        Workflow workflow = workflows.save(Workflow.createDraft(workspaceId, "Mail", "d", USER_ID));
        Map<String, Object> manual = Map.of("id", "manual", "type", "trigger.manual", "config", Map.of());
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("connectionId", connection.toString());
        if (query != null) {
            config.put("query", query);
            config.put("pollIntervalMinutes", 10);
        }
        Map<String, Object> gmail = Map.of("id", "gmail", "type", "trigger.gmail", "config", config);
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("schemaVersion", "1.0");
        definition.put("nodes", new ArrayList<>(List.of(manual, gmail)));
        definition.put("edges", List.of());
        definition.put("variables", Map.of());
        workflow.updateDraft(workflow.getName(), workflow.getDescription(), definition, Map.of());
        return workflows.save(workflow);
    }

    private Map<String, Object> row(UUID workflowId) {
        return jdbc.queryForMap("select id, status, next_run_at, poll_cursor, last_error::text as last_error "
                + "from workflow.workflow_triggers where workflow_id = ? and type = 'GMAIL' "
                + "order by created_at desc limit 1", workflowId);
    }

    @Test
    void lifecyclePublishStartsPollingAtNowPauseStopsItResumeResetsTheCursorAndRepublishRetiresTheOldTrigger() {
        Workflow workflow = draft("in:inbox");
        Instant before = Instant.now().minusSeconds(1);

        publication.publish(workspaceId, workflow.getId(), USER_ID);

        Map<String, Object> first = row(workflow.getId());
        assertEquals("ACTIVE", first.get("status"));
        assertNotNull(first.get("next_run_at"));
        Instant firstCursor = ((java.sql.Timestamp) first.get("poll_cursor")).toInstant();
        assertTrue(firstCursor.isAfter(before), "mail from before publishing never starts a run");

        publication.pause(workspaceId, workflow.getId(), USER_ID);
        Map<String, Object> paused = row(workflow.getId());
        assertEquals("DISABLED", paused.get("status"));
        assertNull(paused.get("next_run_at"));
        assertEquals(0, gmailTriggers.findDueGmail(Instant.now().plusSeconds(3600), 1000).stream()
                .filter(c -> c.triggerId().equals(first.get("id"))).count());

        publication.resume(workspaceId, workflow.getId(), USER_ID);
        Map<String, Object> resumed = row(workflow.getId());
        assertEquals("ACTIVE", resumed.get("status"));
        assertNotNull(resumed.get("next_run_at"));
        assertTrue(((java.sql.Timestamp) resumed.get("poll_cursor")).toInstant().isAfter(firstCursor)
                || ((java.sql.Timestamp) resumed.get("poll_cursor")).toInstant().equals(firstCursor));

        // A changed draft publishes a new version: the old registration is retired, the new one polls.
        Workflow again = workflows.findByWorkspaceAndId(workspaceId, workflow.getId()).orElseThrow();
        Map<String, Object> definition = new LinkedHashMap<>(again.getDraftDefinition());
        definition.put("variables", Map.of("rev", "2"));
        again.updateDraft(again.getName(), again.getDescription(), definition, Map.of());
        workflows.save(again);
        publication.publish(workspaceId, workflow.getId(), USER_ID);

        assertEquals(1, jdbc.queryForObject("select count(*) from workflow.workflow_triggers "
                + "where workflow_id = ? and type = 'GMAIL' and status = 'ACTIVE'", Integer.class, workflow.getId()));
        assertEquals("DISABLED", jdbc.queryForObject("select status from workflow.workflow_triggers where id = ?",
                String.class, first.get("id")));
    }

    @Test
    void overlappingPollsStartOneRunPerEmailAndTheCursorOnlyMovesForward() {
        Workflow workflow = draft(null);
        publication.publish(workspaceId, workflow.getId(), USER_ID);
        UUID triggerId = (UUID) row(workflow.getId()).get("id");
        Instant cursor0 = ((java.sql.Timestamp) row(workflow.getId()).get("poll_cursor")).toInstant();
        Instant t1 = cursor0.plusSeconds(5);
        Instant t2 = cursor0.plusSeconds(9);

        // Both polls list m1 (second granularity overlap); the second also sees m2. Labels changed in between.
        List<List<GmailMailboxPort.Message>> pages = List.of(
                List.of(new GmailMailboxPort.Message("m1", t1, Map.of("messageId", "m1", "labelIds", List.of("UNREAD")))),
                List.of(new GmailMailboxPort.Message("m1", t1, Map.of("messageId", "m1", "labelIds", List.of())),
                        new GmailMailboxPort.Message("m2", t2, Map.of("messageId", "m2", "labelIds", List.of()))));
        int[] call = {0};
        boolean[] txOpen = {false};
        GmailMailboxPort mailbox = (conn, query, after, max) -> {
            txOpen[0] = org.springframework.transaction.support.TransactionSynchronizationManager
                    .isActualTransactionActive();
            return GmailMailboxPort.FetchResult.of(pages.get(call[0]++));
        };
        WorkspaceConnectionPort workspace = new WorkspaceConnectionPort() {
            @Override
            public void authorizeAttachment(UUID w, UUID c, UUID u) {
            }

            @Override
            public ResolvedConnection resolve(UUID w, UUID c) {
                return new ResolvedConnection("GMAIL", "OAUTH2", Map.of("accessToken", "t"));
            }

            @Override
            public void reportAuthenticationRejected(UUID w, UUID c) {
            }
        };
        GmailTriggerProcessor processor = new GmailTriggerProcessor(workflows, triggers, gmailTriggers, admissions,
                workspace, mailbox, transactions);
        GmailTriggerPort.Candidate candidate = new GmailTriggerPort.Candidate(workflow.getId(), triggerId);

        assertEquals(1, processor.poll(candidate, Instant.now().plusSeconds(1)));
        assertEquals(1, processor.poll(candidate, Instant.now().plusSeconds(1000)));

        assertEquals(false, txOpen[0]);
        assertEquals(2, jdbc.queryForObject("select count(*) from workflow.workflow_executions where trigger_id = ?",
                Integer.class, triggerId), "m1 once despite the overlap, plus m2");
        assertEquals("GMAIL", jdbc.queryForObject("select distinct trigger_type from workflow.workflow_executions "
                + "where trigger_id = ?", String.class, triggerId));
        assertEquals(t2, ((java.sql.Timestamp) row(workflow.getId()).get("poll_cursor")).toInstant());

        // An older value never moves the cursor back; an error is recorded and later cleared.
        gmailTriggers.recordGmailPoll(triggerId, t1, "GMAIL_POLL_FAILED");
        Map<String, Object> failed = row(workflow.getId());
        assertEquals(t2, ((java.sql.Timestamp) failed.get("poll_cursor")).toInstant());
        assertTrue(((String) failed.get("last_error")).contains("GMAIL_POLL_FAILED"));
        gmailTriggers.recordGmailPoll(triggerId, null, null);
        assertNull(row(workflow.getId()).get("last_error"));
    }
}
