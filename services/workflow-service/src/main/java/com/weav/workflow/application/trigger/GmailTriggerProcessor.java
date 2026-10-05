package com.weav.workflow.application.trigger;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ConnectionReconnectRequiredException;
import com.weav.workflow.application.port.out.GmailMailboxPort;
import com.weav.workflow.application.port.out.GmailTriggerPort;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.domain.exception.IdempotencyKeyReusedException;
import com.weav.workflow.domain.exception.InvalidStateException;
import com.weav.workflow.domain.exception.ResourceNotFoundException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionOperations;

/**
 * Polls one Gmail trigger. No database lock or transaction is open while Workspace or Gmail are called:
 * (1) a short claim transaction locks workflow then trigger (the schedule processor order), checks the
 * registration is current and due, and pushes the next poll out by the interval; (2) the mailbox is read
 * outside any transaction; (3) each email is admitted in its own short transaction under the key
 * {@code gmail:<triggerId>:<messageId>}; (4) the cursor moves forward in a last short transaction.
 */
@Service
public class GmailTriggerProcessor {
    private static final Logger logger = LoggerFactory.getLogger(GmailTriggerProcessor.class);

    static final int DEFAULT_INTERVAL_MINUTES = 5;
    // ponytail: each poll reads at most the newest 100 matches (messages.list) and admits the oldest 10 of them, so
    // the cursor never skips mail; a backlog above 100 within one interval LOSES its oldest part (recorded as
    // GMAIL_BACKLOG_TRUNCATED). Upgrade: users.history.list from a stored historyId, which lists every change.
    static final int MAX_MESSAGES_PER_POLL = 10;
    /** Stable codes shown to the user on the trigger; anything else collapses to GMAIL_POLL_FAILED. */
    private static final Set<String> VISIBLE_CODES = Set.of(
            ConnectionReconnectRequiredException.CODE, "AUTHENTICATION_REJECTED",
            "CONNECTION_FORBIDDEN", "CONNECTION_UNAVAILABLE");
    static final String GENERIC_FAILURE = "GMAIL_POLL_FAILED";

    private final WorkflowRepository workflows;
    private final WorkflowTriggerPort triggers;
    private final GmailTriggerPort gmailTriggers;
    private final ExecutionAdmissionService admissions;
    private final WorkspaceConnectionPort connections;
    private final GmailMailboxPort mailbox;
    private final TransactionOperations transactions;

    public GmailTriggerProcessor(WorkflowRepository workflows, WorkflowTriggerPort triggers,
                                 GmailTriggerPort gmailTriggers, ExecutionAdmissionService admissions,
                                 WorkspaceConnectionPort connections, GmailMailboxPort mailbox,
                                 TransactionOperations transactions) {
        this.workflows = Objects.requireNonNull(workflows);
        this.triggers = Objects.requireNonNull(triggers);
        this.gmailTriggers = Objects.requireNonNull(gmailTriggers);
        this.admissions = Objects.requireNonNull(admissions);
        this.connections = Objects.requireNonNull(connections);
        this.mailbox = Objects.requireNonNull(mailbox);
        this.transactions = Objects.requireNonNull(transactions);
    }

    /** Returns how many runs were admitted. A Gmail or Workspace failure is recorded on the trigger, not thrown. */
    public int poll(GmailTriggerPort.Candidate candidate, Instant scanTime) {
        Objects.requireNonNull(candidate, "candidate must not be null");
        Objects.requireNonNull(scanTime, "scanTime must not be null");
        Claim claim = transactions.execute(status -> claim(candidate, scanTime));
        if (claim == null) {
            return 0;
        }

        GmailMailboxPort.FetchResult fetched;
        try (ResolvedConnection connection = connections.resolve(claim.workspaceId(), claim.connectionId())) {
            try {
                fetched = mailbox.fetchNew(connection, claim.query(), claim.cursor(), claim.cursorMessageId(),
                        MAX_MESSAGES_PER_POLL);
            } catch (NodeExecutor.Failure failure) {
                if ("AUTHENTICATION_REJECTED".equals(failure.code())) {
                    reportRejected(claim, connection);
                }
                return failed(claim, failure.code());
            }
        } catch (ForbiddenException denied) {
            return failed(claim, "CONNECTION_FORBIDDEN");
        } catch (ConnectionReconnectRequiredException reconnect) {
            return failed(claim, ConnectionReconnectRequiredException.CODE);
        } catch (RuntimeException unavailable) {
            return failed(claim, "CONNECTION_UNAVAILABLE");
        }

        int admitted = 0;
        Instant cursor = null;
        String lastId = null;
        String error = null;
        for (GmailMailboxPort.Message message : fetched.messages()) {
            if (message.isSkipMarker()) {
                lastId = message.id(); // unreadable or from before the cursor: move the position past it
                continue;
            }
            try {
                Outcome outcome = admit(claim, message);
                if (outcome == Outcome.GONE) {
                    break; // paused, replaced or deleted while polling: nothing more to admit, keep the cursor
                }
                if (outcome == Outcome.SKIPPED) {
                    continue; // older than the cursor of a pause/resume that happened while polling
                }
                admitted++;
            } catch (IdempotencyKeyReusedException alreadyAdmitted) {
                // An overlapping poll or an earlier tick admitted this email (or its labels changed since).
            } catch (InvalidStateException | ResourceNotFoundException gone) {
                break;
            } catch (BadRequestException rejected) {
                logger.warn("event=gmail_message_skipped triggerId={} reason=admission_rejected", claim.triggerId());
            } catch (RuntimeException failure) {
                // Unexpected (for example a database error): stop here, keep the position before this email so the
                // next poll retries it. Never skipped silently.
                logger.warn("event=gmail_admission_failed triggerId={} messageId={} errorType={}", claim.triggerId(),
                        message.id(), failure.getClass().getSimpleName());
                error = GENERIC_FAILURE;
                break;
            }
            lastId = message.id();
            cursor = cursor == null || message.internalDate().isAfter(cursor) ? message.internalDate() : cursor;
        }
        gmailTriggers.recordGmailPoll(claim.triggerId(), cursor, lastId, error != null ? error : fetched.notice());
        if (error != null) {
            logger.warn("event=gmail_poll_failed triggerId={} code={}", claim.triggerId(), error);
        } else if (fetched.notice() != null) {
            logger.warn("event=gmail_poll_notice triggerId={} code={}", claim.triggerId(), fetched.notice());
        }
        if (admitted > 0) {
            logger.info("event=gmail_poll_admitted triggerId={} runs={}", claim.triggerId(), admitted);
        }
        return admitted;
    }

    private enum Outcome { ADMITTED, SKIPPED, GONE }

    /**
     * One short transaction per email. It re-takes the locks (workflow, then trigger) and re-reads the trigger, so a
     * pause/resume or republish that happened while Gmail was being read is honoured: mail older than the current
     * cursor is skipped, a no longer active registration stops the poll.
     */
    private Outcome admit(Claim claim, GmailMailboxPort.Message message) {
        return transactions.execute(status -> {
            Workflow workflow = workflows.lockById(claim.workflowId()).orElse(null);
            WorkflowTrigger trigger = workflow == null ? null
                    : triggers.lockCurrent(claim.workflowId(), claim.triggerId()).orElse(null);
            if (trigger == null || workflow.getStatus() != WorkflowStatus.PUBLISHED
                    || !trigger.getWorkflowVersionId().equals(workflow.getCurrentVersionId())
                    || trigger.getStatus() != TriggerStatus.ACTIVE) {
                return Outcome.GONE;
            }
            if (trigger.getPollCursor() != null && message.internalDate().isBefore(trigger.getPollCursor())) {
                return Outcome.SKIPPED;
            }
            admissions.automatic(claim.triggerId(), message.input(), null, null, null,
                    "gmail:" + claim.triggerId() + ":" + message.id());
            return Outcome.ADMITTED;
        });
    }

    private Claim claim(GmailTriggerPort.Candidate candidate, Instant scanTime) {
        // Match automatic admission lock order: workflow row, then trigger row.
        Workflow workflow = workflows.lockById(candidate.workflowId()).orElse(null);
        if (workflow == null) {
            return null;
        }
        Optional<WorkflowTrigger> locked = triggers.lockCurrent(candidate.workflowId(), candidate.triggerId());
        if (locked.isEmpty()) {
            return null;
        }
        WorkflowTrigger trigger = locked.get();
        if (workflow.getStatus() != WorkflowStatus.PUBLISHED
                || workflow.getCurrentVersionId() == null
                || !workflow.getCurrentVersionId().equals(trigger.getWorkflowVersionId())
                || trigger.getStatus() != TriggerStatus.ACTIVE
                || trigger.getType() != TriggerType.GMAIL
                || trigger.getNextRunAt() == null
                || trigger.getNextRunAt().isAfter(scanTime)) {
            return null; // not eligible, or another scanner already claimed this poll
        }
        UUID connectionId;
        try {
            connectionId = UUID.fromString((String) trigger.getConfig().get("connectionId"));
        } catch (RuntimeException invalid) {
            throw new IllegalStateException("Stored Gmail registration is missing validated configuration");
        }
        gmailTriggers.advanceGmailPoll(trigger.getId(), scanTime.plus(interval(trigger)));
        Object query = trigger.getConfig().get("query");
        return new Claim(workflow.getId(), trigger.getId(), workflow.getWorkspaceId(), connectionId,
                query instanceof String text && !text.isBlank() ? text.strip() : null,
                trigger.getPollCursor() == null ? scanTime : trigger.getPollCursor(), trigger.getPollCursorMessageId());
    }

    private static Duration interval(WorkflowTrigger trigger) {
        Object minutes = trigger.getConfig().get("pollIntervalMinutes");
        return Duration.ofMinutes(minutes instanceof Number number && number.longValue() >= 1
                ? number.longValue() : DEFAULT_INTERVAL_MINUTES);
    }

    private int failed(Claim claim, String code) {
        String visible = VISIBLE_CODES.contains(code) ? code : GENERIC_FAILURE;
        logger.warn("event=gmail_poll_failed triggerId={} code={}", claim.triggerId(), visible);
        try {
            gmailTriggers.recordGmailPoll(claim.triggerId(), null, null, visible);
        } catch (RuntimeException recordingFailure) {
            logger.warn("event=gmail_poll_error_not_recorded triggerId={}", claim.triggerId());
        }
        return 0;
    }

    private void reportRejected(Claim claim, ResolvedConnection connection) {
        try {
            connections.reportAuthenticationRejected(claim.workspaceId(), claim.connectionId(), connection);
        } catch (RuntimeException ignored) {
            // Gmail confirmed the rejection; keep its classification even if Workspace is unavailable.
        }
    }

    private record Claim(UUID workflowId, UUID triggerId, UUID workspaceId, UUID connectionId, String query, Instant cursor,
                         String cursorMessageId) {
    }
}
