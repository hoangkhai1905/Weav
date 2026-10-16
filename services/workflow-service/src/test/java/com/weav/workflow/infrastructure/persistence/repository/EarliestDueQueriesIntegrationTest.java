package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.port.out.GmailTriggerPort;
import com.weav.workflow.application.port.out.WorkflowNotificationOutboxStore;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.domain.model.aggregate.execution.WorkflowExecution;
import com.weav.workflow.domain.port.out.OutboxEventRepository;
import com.weav.workflow.domain.port.out.WorkflowExecutionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The idle-sleep MIN queries mirror the claim/scan predicates, against real PostgreSQL. */
@SpringBootTest(properties = {
        "weav.workflow.execution-outbox.initial-delay=3600000",
        "weav.workflow.execution-outbox.poll-interval=3600000",
        "weav.workflow.notification-outbox.initial-delay=3600000",
        "weav.workflow.notification-outbox.poll-interval=3600000",
        "weav.workflow.schedule.scanner.enabled=false"
})
@Import(WorkflowPublicationTestConfiguration.class)
class EarliestDueQueriesIntegrationTest {
    private static final String DEFINITION = "{\"schemaVersion\":\"1.0\",\"nodes\":[],\"edges\":[],\"variables\":{}}";

    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private OutboxEventRepository executionOutbox;
    @Autowired
    private WorkflowNotificationOutboxStore notificationOutbox;
    @Autowired
    private WorkflowTriggerPort schedules;
    @Autowired
    private GmailTriggerPort gmail;
    @Autowired
    private WorkflowExecutionRepository executions;
    @Autowired
    @org.springframework.beans.factory.annotation.Qualifier("triggerActivity")
    private com.weav.workflow.infrastructure.scheduling.ActivitySignal triggerActivity;

    private UUID workflow;
    private UUID version;

    @BeforeEach
    void isolateFromOtherTests() {
        jdbc.update("update workflow.outbox_events set status = 'PUBLISHED', published_at = CURRENT_TIMESTAMP, "
                + "publisher_lease_token = null, publisher_lease_until = null where status = 'PENDING'");
        jdbc.update("update workflow.notification_outbox set status = 'PUBLISHED', claim_token = null, "
                + "lease_until = null where status in ('PENDING', 'CLAIMED')");
        jdbc.update("update workflow.workflow_triggers set status = 'DISABLED' where status = 'ACTIVE'");
        workflow = UUID.randomUUID();
        version = UUID.randomUUID();
        UUID actor = UUID.randomUUID();
        jdbc.update("insert into workflow.workflows (id, workspace_id, name, status, schema_version, "
                + "draft_definition, created_by) values (?, ?, 'Due', 'PUBLISHED', '1.0', cast(? as jsonb), ?)",
                workflow, UUID.randomUUID(), DEFINITION, actor);
        jdbc.update("insert into workflow.workflow_versions (id, workflow_id, version_number, definition, "
                + "schema_version, published_by) values (?, ?, 1, cast(? as jsonb), '1.0', ?)",
                version, workflow, DEFINITION, actor);
        jdbc.update("update workflow.workflows set current_version_id = ? where id = ?", version, workflow);
    }

    @Test
    void executionOutboxDueIsTheRetryTimeOrTheLeaseExpiryWhicheverIsLater() {
        assertEquals(Optional.empty(), executionOutbox.findEarliestPendingDue());

        outbox(10, null);      // due in 10 minutes
        outbox(-5, 2);         // retry time passed but another publisher holds the lease for 2 more minutes

        assertNear(2 * 60, executionOutbox.findEarliestPendingDue().orElseThrow());
    }

    @Test
    void notificationOutboxDueCoversPendingRetriesAndExpiringClaims() {
        assertEquals(Optional.empty(), notificationOutbox.findEarliestDue());

        notification("PENDING", 15, null);
        notification("CLAIMED", -1, 3);

        assertNear(3 * 60, notificationOutbox.findEarliestDue().orElseThrow());
    }

    @Test
    void scheduleDueMirrorsTheScanPredicate() {
        assertEquals(Optional.empty(), schedules.findEarliestScheduleDue());

        trigger("SCHEDULE", "ACTIVE", "30 minutes", null);
        trigger("SCHEDULE", "ACTIVE", "1 hour", "2 hours"); // a recorded retry postpones the slot
        trigger("SCHEDULE", "DISABLED", "1 minute", null);   // paused triggers never count
        assertNear(30 * 60, schedules.findEarliestScheduleDue().orElseThrow());

        trigger("SCHEDULE", "ACTIVE", null, "10 minutes");   // not initialised yet but backing off
        assertNear(10 * 60, schedules.findEarliestScheduleDue().orElseThrow());

        trigger("SCHEDULE", "ACTIVE", null, null);           // never scanned: due at once
        assertTrue(schedules.findEarliestScheduleDue().orElseThrow().isBefore(Instant.now()));
    }

    @Test
    void gmailDueIsTheEarliestNextPollOfActiveRegistrations() {
        assertEquals(Optional.empty(), gmail.findEarliestGmailDue());

        trigger("GMAIL", "ACTIVE", "20 minutes", null);
        trigger("GMAIL", "ACTIVE", "5 minutes", null);
        trigger("GMAIL", "DISABLED", "1 minute", null);
        trigger("GMAIL", "ACTIVE", null, null);

        assertNear(5 * 60, gmail.findEarliestGmailDue().orElseThrow());
    }

    @Test
    void findAllByIdReturnsOnlyTheExecutionsThatExist() {
        UUID first = execution();
        UUID second = execution();

        List<WorkflowExecution> found = executions.findAllById(Set.of(first, second, UUID.randomUUID()));

        assertEquals(Set.of(first, second), Set.copyOf(found.stream().map(WorkflowExecution::getId).toList()));
        assertEquals(List.of(), executions.findAllById(Set.of()));
    }

    private void outbox(int nextAttemptInMinutes, Integer leaseInMinutes) {
        jdbc.update("insert into workflow.outbox_events (id, aggregate_type, aggregate_id, event_type, payload, "
                + "status, created_at, next_attempt_at, publisher_lease_token, publisher_lease_until) "
                + "values (?, 'WORKFLOW_EXECUTION', ?, 'EXECUTION_REQUESTED', '{}'::jsonb, 'PENDING', "
                + "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + (? * INTERVAL '1 minute'), "
                + "case when ?::int is null then null else gen_random_uuid() end, "
                + "CURRENT_TIMESTAMP + (?::int * INTERVAL '1 minute'))",
                UUID.randomUUID(), UUID.randomUUID(), nextAttemptInMinutes, leaseInMinutes, leaseInMinutes);
    }

    private void notification(String status, int nextAttemptInMinutes, Integer leaseInMinutes) {
        jdbc.update("insert into workflow.notification_outbox (event_id, event_type, occurred_at, workspace_id, "
                + "recipient_user_id, entity_kind, entity_id, requires_monitor_access, payload, status, "
                + "next_attempt_at, claim_token, lease_until) values (?, 'workflow.created', CURRENT_TIMESTAMP, ?, ?, "
                + "'WORKFLOW', ?, false, '{}'::jsonb, ?, CURRENT_TIMESTAMP + (? * INTERVAL '1 minute'), "
                + "case when ?::int is null then null else gen_random_uuid() end, "
                + "CURRENT_TIMESTAMP + (?::int * INTERVAL '1 minute'))",
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), status,
                nextAttemptInMinutes, leaseInMinutes, leaseInMinutes);
    }

    /** {@code nextRunIn} / {@code retryIn} are PostgreSQL interval texts, null for no value. */
    private void trigger(String type, String status, String nextRunIn, String retryIn) {
        jdbc.update("insert into workflow.workflow_triggers (id, workflow_id, workflow_version_id, trigger_node_id, "
                + "type, status, next_run_at, last_error) values (?, ?, ?, ?, ?, ?, "
                + "case when ?::text is null then null else CURRENT_TIMESTAMP + (?::text)::interval end, "
                + "case when ?::text is null then null else jsonb_build_object('code', 'SCHEDULE_FAILED', "
                + "'retryAt', CURRENT_TIMESTAMP + (?::text)::interval) end)",
                UUID.randomUUID(), workflow, version, "node-" + UUID.randomUUID(), type, status,
                nextRunIn, nextRunIn, retryIn, retryIn);
    }

    private UUID execution() {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into workflow.workflow_executions (id, workflow_id, workflow_version_id, status, "
                + "trigger_type) values (?, ?, ?, 'QUEUED', 'MANUAL')", id, workflow, version);
        return id;
    }

    private static void assertNear(long secondsFromNow, Instant actual) {
        Duration diff = Duration.between(Instant.now().plusSeconds(secondsFromNow), actual).abs();
        assertTrue(diff.compareTo(Duration.ofSeconds(30)) < 0, "expected about +" + secondsFromNow + " s, was " + actual);
    }

    @Test
    void aCommittedTriggerWriteRaisesTheScannerWakeSignal() {
        long before = triggerActivity.generation();

        schedules.setCurrentEnabled(workflow, version, false, Instant.now(), java.util.Map.of());

        assertTrue(triggerActivity.generation() > before);
    }

    @Test
    void triggersOfWorkflowsTheProcessorsWouldSkipAreIgnored() {
        jdbc.update("update workflow.workflows set status = 'PAUSED' where id = ?", workflow);
        trigger("SCHEDULE", "ACTIVE", "1 minute", null);
        trigger("GMAIL", "ACTIVE", "1 minute", null);
        assertEquals(Optional.empty(), schedules.findEarliestScheduleDue());
        assertEquals(Optional.empty(), gmail.findEarliestGmailDue());

        jdbc.update("update workflow.workflows set status = 'PUBLISHED', current_version_id = null where id = ?",
                workflow); // version mismatch
        assertEquals(Optional.empty(), schedules.findEarliestScheduleDue());
        assertEquals(Optional.empty(), gmail.findEarliestGmailDue());

        jdbc.update("update workflow.workflows set current_version_id = ? where id = ?", version, workflow);
        assertNear(60, schedules.findEarliestScheduleDue().orElseThrow());
        assertNear(60, gmail.findEarliestGmailDue().orElseThrow());
    }
}
