package com.weav.workspace.application.usecase;

import com.weav.workspace.application.notification.WorkspaceNotificationRecorder;
import com.weav.workspace.application.port.out.AfterCommitExecutor;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkflowShutdownPort;
import com.weav.workspace.application.port.out.WorkspaceMutationLock;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceAuthorizationCache;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.valueobject.MembershipRole;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * Soft-deletes a workspace (owner only, confirmed by typing its name). Order matters: the Workflow Service is
 * asked to pause every workflow FIRST, outside any transaction or lock, because unregistering a Telegram bot
 * reads the connection credential that this use case wipes afterwards. If that call fails (or reports a
 * workflow it could not pause) the workspace itself is untouched: nothing is deleted, although some workflows
 * may already be paused, and the owner can retry because pause-all is idempotent. Only then does one
 * transaction mark the workspace DELETED, disable its connections, delete their credentials and queue the
 * notifications. After commit a second, best-effort pause-all closes the window in which a workflow could have
 * been published or resumed since the first call.
 */
@Service
public final class DeleteWorkspaceUseCase {

    private static final Logger log = LoggerFactory.getLogger(DeleteWorkspaceUseCase.class);

    private final WorkspaceRepository workspaceRepository;
    private final MembershipRepository membershipRepository;
    private final ConnectionRepository connectionRepository;
    private final CredentialRepository credentialRepository;
    private final TransactionRunner transactionRunner;
    private final WorkspaceMutationLock mutationLock;
    private final WorkspaceNotificationRecorder notifications;
    private final WorkflowShutdownPort workflowShutdown;
    private final AfterCommitExecutor afterCommitExecutor;
    private final WorkspaceAuthorizationCache authorizationCache;

    public DeleteWorkspaceUseCase(
            WorkspaceRepository workspaceRepository,
            MembershipRepository membershipRepository,
            ConnectionRepository connectionRepository,
            CredentialRepository credentialRepository,
            TransactionRunner transactionRunner,
            WorkspaceMutationLock mutationLock,
            WorkspaceNotificationRecorder notifications,
            WorkflowShutdownPort workflowShutdown,
            AfterCommitExecutor afterCommitExecutor,
            WorkspaceAuthorizationCache authorizationCache) {
        this.workspaceRepository = Objects.requireNonNull(workspaceRepository);
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.connectionRepository = Objects.requireNonNull(connectionRepository);
        this.credentialRepository = Objects.requireNonNull(credentialRepository);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.mutationLock = Objects.requireNonNull(mutationLock);
        this.notifications = Objects.requireNonNull(notifications);
        this.workflowShutdown = Objects.requireNonNull(workflowShutdown);
        this.afterCommitExecutor = Objects.requireNonNull(afterCommitExecutor);
        this.authorizationCache = Objects.requireNonNull(authorizationCache);
    }

    public void execute(UUID actorUserId, UUID workspaceId, String confirmationName) {
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        if (confirmationName == null || confirmationName.isBlank()) {
            throw new BadRequestException("Workspace name confirmation is required");
        }
        // 1. Reject non-owners and wrong names before any side effect.
        transactionRunner.required(() -> authorizeOwner(actorUserId, workspaceId, confirmationName));
        // 2. Stop the workflows (HTTP, no transaction held). Failure aborts with DependencyUnavailable (503).
        WorkflowShutdownPort.PauseAllResult shutdown = workflowShutdown.pauseAll(workspaceId);
        if (shutdown.failed() > 0) {
            log.warn("event=workspace_delete_aborted workspaceId={} actorUserId={} unpausedWorkflows={}",
                    workspaceId, actorUserId, shutdown.failed());
            throw new DependencyUnavailableException();
        }
        // 3. Commit the deletion; the authorization is re-checked under the workspace lock.
        List<UUID> memberIds = transactionRunner.required(
                () -> deleteInTransaction(actorUserId, workspaceId, confirmationName));
        log.info("event=workspace_deleted workspaceId={} actorUserId={} members={} pausedWorkflows={} "
                        + "alreadyPausedWorkflows={} failedTelegramUnregister={}",
                workspaceId, actorUserId, memberIds.size(), shutdown.paused(), shutdown.alreadyPaused(),
                shutdown.failedTelegramUnregister());
    }

    private Workspace authorizeOwner(UUID actorUserId, UUID workspaceId, String confirmationName) {
        Membership membership = membershipRepository.findByWorkspaceIdAndUserId(workspaceId, actorUserId)
                .orElseThrow(() -> new ResourceNotFoundException("Workspace not found", workspaceId));
        if (membership.getRole() != MembershipRole.OWNER) {
            throw new ForbiddenException();
        }
        Workspace workspace = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new ResourceNotFoundException("Workspace not found", workspaceId));
        requireNameMatches(workspace, confirmationName);
        return workspace;
    }

    private List<UUID> deleteInTransaction(UUID actorUserId, UUID workspaceId, String confirmationName) {
        mutationLock.lock(workspaceId);
        Workspace workspace = authorizeOwner(actorUserId, workspaceId, confirmationName);
        List<UUID> memberIds = membershipRepository.findUserIdsByWorkspaceId(workspaceId);
        workspace.markDeleted(actorUserId, Instant.now());
        workspaceRepository.save(workspace);
        // Bulk statements on purpose: they bypass ConnectionUsageProtection, whose "in use" guard is exactly
        // what a workspace delete overrides (the workflows were paused in step 2).
        connectionRepository.disableAllByWorkspaceId(workspaceId);
        credentialRepository.deleteAllByWorkspaceId(workspaceId);
        notifications.recordDeleted(workspaceId, actorUserId, workspace.getName(), memberIds);
        afterCommitExecutor.execute(() -> memberIds.forEach(userId -> evict(workspaceId, userId)));
        afterCommitExecutor.execute(() -> pauseAgainBestEffort(workspaceId, actorUserId));
        return memberIds;
    }

    /**
     * A workflow may have been published or resumed after the first pause-all and before the commit. The
     * workspace is deleted either way, so a failure here is only logged.
     */
    private void pauseAgainBestEffort(UUID workspaceId, UUID actorUserId) {
        try {
            workflowShutdown.pauseAll(workspaceId);
        } catch (RuntimeException exception) {
            log.warn("event=workspace_delete_second_pause_failed workspaceId={} actorUserId={} errorType={}",
                    workspaceId, actorUserId, exception.getClass().getSimpleName());
        }
    }

    private void evict(UUID workspaceId, UUID userId) {
        try {
            authorizationCache.evict(workspaceId, userId);
        } catch (RuntimeException exception) {
            log.warn("Workspace authorization cache eviction failed for workspaceId={} userId={}",
                    workspaceId, userId);
        }
    }

    private static void requireNameMatches(Workspace workspace, String confirmationName) {
        String normalized;
        try {
            normalized = Workspace.normalizeName(confirmationName);
        } catch (IllegalArgumentException exception) {
            throw new BadRequestException("Workspace name confirmation does not match");
        }
        if (!normalized.equals(workspace.getNameNormalized())) {
            throw new BadRequestException("Workspace name confirmation does not match");
        }
    }
}
