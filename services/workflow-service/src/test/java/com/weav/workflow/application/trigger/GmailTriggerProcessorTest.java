package com.weav.workflow.application.trigger;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ConnectionReconnectRequiredException;
import com.weav.workflow.application.port.out.GmailMailboxPort;
import com.weav.workflow.application.port.out.GmailTriggerPort;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.domain.exception.IdempotencyKeyReusedException;
import com.weav.workflow.domain.exception.InvalidStateException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionOperations;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class GmailTriggerProcessorTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-0000000000a1");
    private static final UUID WORKFLOW_ID = UUID.fromString("10000000-0000-0000-0000-0000000000a2");
    private static final UUID VERSION_ID = UUID.fromString("10000000-0000-0000-0000-0000000000a3");
    private static final UUID TRIGGER_ID = UUID.fromString("10000000-0000-0000-0000-0000000000a4");
    private static final UUID CONNECTION_ID = UUID.fromString("10000000-0000-0000-0000-0000000000a5");
    private static final Instant NOW = Instant.parse("2026-10-05T10:00:00Z");
    private static final Instant CURSOR = Instant.parse("2026-10-05T09:58:00Z");
    private static final GmailTriggerPort.Candidate CANDIDATE = new GmailTriggerPort.Candidate(WORKFLOW_ID, TRIGGER_ID);

    @Mock
    private WorkflowRepository workflows;
    @Mock
    private WorkflowTriggerPort triggers;
    @Mock
    private GmailTriggerPort gmailTriggers;
    @Mock
    private ExecutionAdmissionService admissions;
    @Mock
    private WorkspaceConnectionPort connections;

    /** True only while a claim transaction is open, so fakes can prove nothing slow runs inside one. */
    private final AtomicBoolean inTransaction = new AtomicBoolean();
    private final TransactionOperations transactions = new TransactionOperations() {
        @Override
        public <T> T execute(TransactionCallback<T> action) {
            inTransaction.set(true);
            try {
                return action.doInTransaction(null);
            } finally {
                inTransaction.set(false);
            }
        }
    };
    private final List<String> mailboxCalls = new ArrayList<>();
    private List<GmailMailboxPort.Message> mailboxResult = List.of();
    private String mailboxNotice;
    private RuntimeException mailboxFailure;
    private Instant mailboxAfter;
    private String mailboxAfterId;
    private int mailboxMax;
    private boolean transactionOpenDuringMailbox;
    private boolean transactionOpenDuringResolve;

    private final GmailMailboxPort mailbox = (connection, query, after, afterId, max) -> {
        transactionOpenDuringMailbox = inTransaction.get();
        mailboxCalls.add(query == null ? "<none>" : query);
        mailboxAfter = after;
        mailboxAfterId = afterId;
        mailboxMax = max;
        if (mailboxFailure != null) {
            throw mailboxFailure;
        }
        return new GmailMailboxPort.FetchResult(mailboxResult, mailboxNotice);
    };

    private GmailTriggerProcessor processor;
    private WorkflowTrigger trigger;
    private Workflow workflow;

    @BeforeEach
    void setUp() {
        processor = new GmailTriggerProcessor(workflows, triggers, gmailTriggers, admissions, connections,
                mailbox, transactions);
        workflow = new Workflow(WORKFLOW_ID, WORKSPACE_ID, "Workflow", "d", WorkflowStatus.PUBLISHED, "1.0",
                Map.of(), Map.of(), VERSION_ID, UUID.randomUUID(), CURSOR, CURSOR, CURSOR, null, null);
        trigger = new WorkflowTrigger(TRIGGER_ID, WORKFLOW_ID, VERSION_ID, "gmail", TriggerType.GMAIL,
                TriggerStatus.ACTIVE, Map.of("connectionId", CONNECTION_ID.toString(), "query", " in:inbox ",
                "pollIntervalMinutes", 7), null, null, NOW.minusSeconds(1), null, null, CURSOR, CURSOR, CURSOR);
        lenient().when(workflows.lockById(WORKFLOW_ID)).thenReturn(Optional.of(workflow));
        lenient().when(triggers.lockCurrent(WORKFLOW_ID, TRIGGER_ID)).thenAnswer(call -> Optional.of(trigger));
        lenient().when(connections.resolve(WORKSPACE_ID, CONNECTION_ID)).thenAnswer(call -> {
            transactionOpenDuringResolve = inTransaction.get();
            return new ResolvedConnection("GMAIL", "OAUTH2", Map.of("accessToken", "t"));
        });
    }

    private static GmailMailboxPort.Message message(String id, String internalDate) {
        return new GmailMailboxPort.Message(id, Instant.parse(internalDate), Map.of("messageId", id));
    }

    @Test
    void claimLocksWorkflowThenTriggerPushesTheNextPollByTheIntervalAndReadsFromTheCursor() {
        mailboxResult = List.of();

        assertEquals(0, processor.poll(CANDIDATE, NOW));

        InOrder order = inOrder(workflows, triggers, gmailTriggers, connections);
        order.verify(workflows).lockById(WORKFLOW_ID);
        order.verify(triggers).lockCurrent(WORKFLOW_ID, TRIGGER_ID);
        order.verify(gmailTriggers).advanceGmailPoll(TRIGGER_ID, NOW.plus(Duration.ofMinutes(7)));
        order.verify(connections).resolve(WORKSPACE_ID, CONNECTION_ID);
        order.verify(gmailTriggers).recordGmailPoll(TRIGGER_ID, null, null, null);
        assertEquals(List.of("in:inbox"), mailboxCalls);
        assertEquals(CURSOR, mailboxAfter);
        assertEquals(10, mailboxMax);
    }

    @Test
    void noTransactionIsOpenWhileWorkspaceOrGmailAreCalled() {
        mailboxResult = List.of(message("m1", "2026-10-05T09:59:00Z"));

        processor.poll(CANDIDATE, NOW);

        assertFalse(transactionOpenDuringResolve, "Workspace is called after the claim transaction committed");
        assertFalse(transactionOpenDuringMailbox, "Gmail is called after the claim transaction committed");
        verify(gmailTriggers).advanceGmailPoll(eq(TRIGGER_ID), any());
    }

    @Test
    void admitsOldestFirstWithAPerTriggerKeyAndAdvancesTheCursorToTheNewestAdmitted() {
        mailboxResult = List.of(message("m1", "2026-10-05T09:58:30Z"), message("m2", "2026-10-05T09:59:10Z"));

        assertEquals(2, processor.poll(CANDIDATE, NOW));

        InOrder order = inOrder(admissions, gmailTriggers);
        order.verify(admissions).automatic(TRIGGER_ID, Map.of("messageId", "m1"), null, null, null,
                "gmail:" + TRIGGER_ID + ":m1");
        order.verify(admissions).automatic(TRIGGER_ID, Map.of("messageId", "m2"), null, null, null,
                "gmail:" + TRIGGER_ID + ":m2");
        order.verify(gmailTriggers).recordGmailPoll(TRIGGER_ID, Instant.parse("2026-10-05T09:59:10Z"), "m2", null);
    }

    @Test
    void anAlreadyAdmittedEmailIsSkippedAndNeverStartsASecondRun() {
        mailboxResult = List.of(message("m1", "2026-10-05T09:58:30Z"), message("m2", "2026-10-05T09:59:10Z"));
        lenient().when(admissions.automatic(eq(TRIGGER_ID), any(), isNull(), isNull(), isNull(), eq("gmail:" + TRIGGER_ID + ":m1")))
                .thenThrow(new IdempotencyKeyReusedException());

        assertEquals(1, processor.poll(CANDIDATE, NOW));

        verify(gmailTriggers).recordGmailPoll(TRIGGER_ID, Instant.parse("2026-10-05T09:59:10Z"), "m2", null);
    }

    @Test
    void aTransientAdmissionFailureStopsBeforeTheFailedEmailAndKeepsItForTheNextPoll() {
        mailboxResult = List.of(message("m1", "2026-10-05T09:58:30Z"), message("m2", "2026-10-05T09:59:10Z"),
                message("m3", "2026-10-05T09:59:20Z"));
        lenient().when(admissions.automatic(eq(TRIGGER_ID), any(), isNull(), isNull(), isNull(), eq("gmail:" + TRIGGER_ID + ":m2")))
                .thenThrow(new IllegalStateException("database down"));

        assertEquals(1, processor.poll(CANDIDATE, NOW));

        verify(gmailTriggers).recordGmailPoll(TRIGGER_ID, Instant.parse("2026-10-05T09:58:30Z"), "m1", "GMAIL_POLL_FAILED");
        verify(admissions, never()).automatic(any(), any(), any(), any(), any(), eq("gmail:" + TRIGGER_ID + ":m3"));
    }

    @Test
    void aWorkflowPausedWhilePollingStopsAdmittingAndKeepsTheCursor() {
        mailboxResult = List.of(message("m1", "2026-10-05T09:58:30Z"));
        when(admissions.automatic(any(), any(), any(), any(), any(), anyString()))
                .thenThrow(new InvalidStateException("The workflow trigger is not active"));

        assertEquals(0, processor.poll(CANDIDATE, NOW));

        verify(gmailTriggers).recordGmailPoll(TRIGGER_ID, null, null, null);
    }

    @Test
    void aNoticeFromTheMailboxIsRecordedOnTheTriggerWhenThePollSucceeds() {
        mailboxResult = List.of(message("m1", "2026-10-05T09:58:30Z"));
        mailboxNotice = "GMAIL_BACKLOG_TRUNCATED";

        assertEquals(1, processor.poll(CANDIDATE, NOW));

        verify(gmailTriggers).recordGmailPoll(TRIGGER_ID, Instant.parse("2026-10-05T09:58:30Z"), "m1",
                "GMAIL_BACKLOG_TRUNCATED");
    }

    @Test
    void mailOlderThanTheCursorReadUnderTheLockIsSkippedAfterAPauseResume() {
        mailboxResult = List.of(message("m1", "2026-10-05T09:58:30Z"), message("m2", "2026-10-05T09:59:10Z"));
        // The claim sees the old cursor; by admission time a resume moved it to 09:59:00.
        when(triggers.lockCurrent(WORKFLOW_ID, TRIGGER_ID)).thenAnswer(call -> Optional.of(trigger))
                .thenAnswer(call -> Optional.of(new WorkflowTrigger(TRIGGER_ID, WORKFLOW_ID, VERSION_ID, "gmail",
                        TriggerType.GMAIL, TriggerStatus.ACTIVE, trigger.getConfig(), null, null, NOW.plusSeconds(60),
                        null, null, Instant.parse("2026-10-05T09:59:00Z"), CURSOR, CURSOR)));

        assertEquals(1, processor.poll(CANDIDATE, NOW));

        verify(admissions, never()).automatic(any(), any(), any(), any(), any(), eq("gmail:" + TRIGGER_ID + ":m1"));
        verify(gmailTriggers).recordGmailPoll(TRIGGER_ID, Instant.parse("2026-10-05T09:59:10Z"), "m2", null);
    }

    @Test
    void skipMarkersMoveThePositionWithoutStartingARunAndTheClaimPassesTheStoredPosition() {
        trigger.withPollCursorMessageId("m0");
        mailboxResult = List.of(GmailMailboxPort.Message.skipped("s1"), message("m2", "2026-10-05T09:59:10Z"),
                GmailMailboxPort.Message.skipped("s3"));

        assertEquals(1, processor.poll(CANDIDATE, NOW));

        assertEquals("m0", mailboxAfterId);
        verify(admissions, never()).automatic(any(), any(), any(), any(), any(), eq("gmail:" + TRIGGER_ID + ":s1"));
        verify(gmailTriggers).recordGmailPoll(TRIGGER_ID, Instant.parse("2026-10-05T09:59:10Z"), "s3", null);
    }

    @Test
    void onlySkipMarkersStillAdvanceTheStoredPosition() {
        mailboxResult = List.of(GmailMailboxPort.Message.skipped("s1"), GmailMailboxPort.Message.skipped("s2"));

        assertEquals(0, processor.poll(CANDIDATE, NOW));

        verify(gmailTriggers).recordGmailPoll(TRIGGER_ID, null, "s2", null);
    }

    @Test
    void anAdmissionRejectedAsBadInputIsSteppedOverWithASkippedNotice() {
        mailboxResult = List.of(message("m1", "2026-10-05T09:58:30Z"));
        lenient().when(admissions.automatic(any(), any(), any(), any(), any(), anyString()))
                .thenThrow(new com.weav.workflow.domain.exception.BadRequestException("Execution input exceeds the supported size"));

        assertEquals(0, processor.poll(CANDIDATE, NOW));

        verify(gmailTriggers).recordGmailPoll(TRIGGER_ID, Instant.parse("2026-10-05T09:58:30Z"), "m1",
                "GMAIL_MESSAGE_SKIPPED");
    }

    @Test
    void aFullSliceBringsTheNextPollForwardToNowSoABacklogDrainsPerTick() {
        for (int poll = 1; poll <= 3; poll++) {
            int size = poll < 3 ? 10 : 5; // 25 mails: 10, 10, 5
            List<GmailMailboxPort.Message> slice = new ArrayList<>();
            for (int i = 0; i < size; i++) {
                slice.add(message("m" + poll + "-" + i, "2026-10-05T09:59:00Z"));
            }
            mailboxResult = slice;

            assertEquals(size, processor.poll(CANDIDATE, NOW));
        }

        // claim pushes next_run_at by the interval each time (3x); only the two full slices pull it back to now
        verify(gmailTriggers, org.mockito.Mockito.times(3)).advanceGmailPoll(TRIGGER_ID, NOW.plus(Duration.ofMinutes(7)));
        verify(gmailTriggers, org.mockito.Mockito.times(2)).advanceGmailPoll(TRIGGER_ID, NOW);
    }

    @Test
    void aFailedOrStoppedPollKeepsTheNormalCadenceEvenWithAFullSlice() {
        List<GmailMailboxPort.Message> slice = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            slice.add(message("m" + i, "2026-10-05T09:59:00Z"));
        }
        mailboxResult = slice;
        lenient().when(admissions.automatic(any(), any(), any(), any(), any(), eq("gmail:" + TRIGGER_ID + ":m3")))
                .thenThrow(new IllegalStateException("database down"));

        processor.poll(CANDIDATE, NOW);

        verify(gmailTriggers, never()).advanceGmailPoll(TRIGGER_ID, NOW);
    }

    @Test
    void notDuePausedReplacedOrForeignRegistrationsNeverReachGmail() {
        trigger = new WorkflowTrigger(TRIGGER_ID, WORKFLOW_ID, VERSION_ID, "gmail", TriggerType.GMAIL,
                TriggerStatus.ACTIVE, Map.of("connectionId", CONNECTION_ID.toString()), null, null,
                NOW.plusSeconds(1), null, null, CURSOR, CURSOR, CURSOR);
        assertEquals(0, processor.poll(CANDIDATE, NOW));

        trigger = new WorkflowTrigger(TRIGGER_ID, WORKFLOW_ID, UUID.randomUUID(), "gmail", TriggerType.GMAIL,
                TriggerStatus.ACTIVE, Map.of("connectionId", CONNECTION_ID.toString()), null, null,
                NOW.minusSeconds(1), null, null, CURSOR, CURSOR, CURSOR);
        assertEquals(0, processor.poll(CANDIDATE, NOW), "trigger of an older version");

        trigger = new WorkflowTrigger(TRIGGER_ID, WORKFLOW_ID, VERSION_ID, "gmail", TriggerType.GMAIL,
                TriggerStatus.DISABLED, Map.of("connectionId", CONNECTION_ID.toString()), null, null,
                NOW.minusSeconds(1), null, null, CURSOR, CURSOR, CURSOR);
        assertEquals(0, processor.poll(CANDIDATE, NOW), "disabled trigger");

        verifyNoInteractions(connections, admissions, gmailTriggers);
        assertTrue(mailboxCalls.isEmpty());
    }

    @Test
    void aConnectionThatMustBeReconnectedIsRecordedWithTheStableCodeAndNothingIsRead() {
        doThrow(new ConnectionReconnectRequiredException()).when(connections).resolve(WORKSPACE_ID, CONNECTION_ID);

        assertEquals(0, processor.poll(CANDIDATE, NOW));

        verify(gmailTriggers).recordGmailPoll(TRIGGER_ID, null, null, "CONNECTION_RECONNECT_REQUIRED");
        assertTrue(mailboxCalls.isEmpty());
        verifyNoInteractions(admissions);
    }

    @Test
    void workspaceDenialAndOutageAreRecordedAsConnectionCodes() {
        doThrow(new ForbiddenException()).when(connections).resolve(WORKSPACE_ID, CONNECTION_ID);
        processor.poll(CANDIDATE, NOW);
        verify(gmailTriggers).recordGmailPoll(TRIGGER_ID, null, null, "CONNECTION_FORBIDDEN");

        doThrow(new WorkspaceDependencyUnavailableException()).when(connections).resolve(WORKSPACE_ID, CONNECTION_ID);
        processor.poll(CANDIDATE, NOW);
        verify(gmailTriggers).recordGmailPoll(TRIGGER_ID, null, null, "CONNECTION_UNAVAILABLE");
    }

    @Test
    void anAuthenticationRejectionIsReportedToWorkspaceAndRecorded() {
        mailboxFailure = new NodeExecutor.Failure("AUTHENTICATION_REJECTED", "Rejected.", false);

        assertEquals(0, processor.poll(CANDIDATE, NOW));

        verify(connections).reportAuthenticationRejected(eq(WORKSPACE_ID), eq(CONNECTION_ID), any());
        verify(gmailTriggers).recordGmailPoll(TRIGGER_ID, null, null, "AUTHENTICATION_REJECTED");
    }

    @Test
    void rateLimitsAndOutagesAreRecordedAsAGenericFailureAndRetriedOnTheNextTickWithoutReporting() {
        mailboxFailure = new NodeExecutor.Failure("HTTP_RATE_LIMITED", "Slow down.", true);

        assertEquals(0, processor.poll(CANDIDATE, NOW));

        verify(gmailTriggers).recordGmailPoll(TRIGGER_ID, null, null, "GMAIL_POLL_FAILED");
        verify(connections, never()).reportAuthenticationRejected(any(), any(), any());
        // The claim already pushed the next poll out, so a failure keeps the normal cadence.
        verify(gmailTriggers).advanceGmailPoll(TRIGGER_ID, NOW.plus(Duration.ofMinutes(7)));
    }

    @Test
    void theIntervalDefaultsToFiveMinutesAndAMissingCursorStartsAtTheScanTime() {
        trigger = new WorkflowTrigger(TRIGGER_ID, WORKFLOW_ID, VERSION_ID, "gmail", TriggerType.GMAIL,
                TriggerStatus.ACTIVE, Map.of("connectionId", CONNECTION_ID.toString()), null, null,
                NOW.minusSeconds(1), null, null, null, CURSOR, CURSOR);

        processor.poll(CANDIDATE, NOW);

        verify(gmailTriggers).advanceGmailPoll(TRIGGER_ID, NOW.plus(Duration.ofMinutes(5)));
        assertEquals(NOW, mailboxAfter);
        assertEquals(List.of("<none>"), mailboxCalls);
    }

    @Test
    void anEmailWhoseKeyWasAlreadyUsedIsNotCountedAsANewRunButStillMovesTheCursor() {
        mailboxResult = List.of(message("m1", "2026-10-05T09:58:30Z"));
        doThrow(new IdempotencyKeyReusedException()).when(admissions)
                .automatic(any(), any(), any(), any(), any(), anyString());

        assertEquals(0, processor.poll(CANDIDATE, NOW));
        verify(gmailTriggers).recordGmailPoll(TRIGGER_ID, Instant.parse("2026-10-05T09:58:30Z"), "m1", null);
    }
}
