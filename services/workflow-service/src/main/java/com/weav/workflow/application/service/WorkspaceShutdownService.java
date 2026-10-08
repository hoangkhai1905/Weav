package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.TelegramWebhookPort;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionOperations;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Called by the Workspace Service just before it soft-deletes a workspace: pauses every published workflow and
 * turns its triggers off, exactly like a member pausing it, but without a capability check (the caller is the
 * trusted service, the owner already confirmed) and without per-workflow {@code workflow.paused} notifications
 * (the members get one {@code workspace.deleted} instead).
 *
 * <p>Idempotent and retriable: a second call finds nothing PUBLISHED. Executions already admitted are left to
 * finish or fail when they next resolve a (by then wiped) connection. A workflow that throws is logged, counted in
 * {@code failed} and skipped so the others are still paused; the caller must treat {@code failed > 0} as "retry". Unregistering a Telegram bot needs its
 * credential, so this must run before the Workspace Service wipes credentials; a failure there is only logged
 * and counted because the webhook endpoint already rejects disabled triggers.</p>
 */
@Service
public class WorkspaceShutdownService {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceShutdownService.class);

    private final WorkflowRepository workflows;
    private final WorkflowTriggerPort triggers;
    private final Optional<TelegramWebhookPort> telegram;
    private final TransactionOperations transactions;

    public WorkspaceShutdownService(
            WorkflowRepository workflows,
            WorkflowTriggerPort triggers,
            Optional<TelegramWebhookPort> telegram,
            TransactionOperations transactions) {
        this.workflows = Objects.requireNonNull(workflows, "workflows must not be null");
        this.triggers = Objects.requireNonNull(triggers, "triggers must not be null");
        this.telegram = Objects.requireNonNull(telegram, "telegram must not be null");
        this.transactions = Objects.requireNonNull(transactions, "transactions must not be null");
    }

    public Result pauseAll(UUID workspaceId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        int alreadyPaused = workflows.findIdsByWorkspaceAndStatus(workspaceId, WorkflowStatus.PAUSED).size();
        int paused = 0;
        int failedUnregister = 0;
        int failed = 0;
        // Each workflow is its own short transaction: a failure leaves earlier ones paused and the call retriable.
        for (UUID workflowId : workflows.findIdsByWorkspaceAndStatus(workspaceId, WorkflowStatus.PUBLISHED)) {
            Set<UUID> bots;
            try {
                bots = transactions.execute(status -> pauseLocked(workspaceId, workflowId));
            } catch (RuntimeException failure) {
                failed++;
                log.warn("event=workspace_workflow_pause_failed workspaceId={} workflowId={} errorType={}",
                        workspaceId, workflowId, failure.getClass().getSimpleName());
                continue;
            }
            if (bots == null) {
                alreadyPaused++; // paused or deleted by someone else between the listing and the lock
                continue;
            }
            paused++;
            failedUnregister += clearUnusedBots(workspaceId, bots);
        }
        log.info("event=workspace_workflows_paused workspaceId={} paused={} alreadyPaused={} "
                        + "failedTelegramUnregister={} failed={}", workspaceId, paused, alreadyPaused, failedUnregister, failed);
        return new Result(paused, alreadyPaused, failedUnregister, failed);
    }

    /** Returns the Telegram bots the workflow was serving, or null when it is no longer PUBLISHED. */
    private Set<UUID> pauseLocked(UUID workspaceId, UUID workflowId) {
        Workflow workflow = workflows.lockByWorkspaceAndId(workspaceId, workflowId).orElse(null);
        if (workflow == null || workflow.getStatus() != WorkflowStatus.PUBLISHED) {
            return null;
        }
        UUID versionId = workflow.getCurrentVersionId();
        workflow.pause();
        Set<UUID> bots = new LinkedHashSet<>();
        for (WorkflowTrigger trigger : triggers.findCurrent(workflowId, versionId)) {
            if (trigger.getType() == TriggerType.TELEGRAM && trigger.getStatus() == TriggerStatus.ACTIVE) {
                bots.add(UUID.fromString((String) trigger.getConfig().get("connectionId")));
            }
        }
        triggers.setCurrentEnabled(workflowId, versionId, false, Instant.now(), Map.of());
        workflows.save(workflow);
        return bots;
    }

    /** Best effort, after the pause committed: returns how many bots could not be unregistered. */
    private int clearUnusedBots(UUID workspaceId, Set<UUID> bots) {
        int failed = 0;
        for (UUID bot : bots) {
            try {
                if (!triggers.hasActiveTelegramTrigger(bot)) {
                    telegram.ifPresent(port -> port.unregister(workspaceId, bot));
                }
            } catch (RuntimeException failure) {
                failed++;
                log.warn("event=telegram_webhook_clear_skipped connectionId={} errorType={}",
                        bot, failure.getClass().getSimpleName());
            }
        }
        return failed;
    }

    public record Result(int paused, int alreadyPaused, int failedTelegramUnregister, int failed) {
    }
}
