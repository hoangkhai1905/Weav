package com.weav.workspace.application.usecase;

import com.weav.workspace.application.port.out.AfterCommitExecutor;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.exception.MembershipNotFoundException;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.WorkspaceAccessSnapshot;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceAuthorizationCache;
import com.weav.workspace.domain.policy.WorkspaceAuthorizationPolicy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

@Service
public final class ResolveWorkspaceAccessUseCase {

    private static final Logger log = LoggerFactory.getLogger(ResolveWorkspaceAccessUseCase.class);

    private final MembershipRepository membershipRepository;
    private final WorkspaceAuthorizationPolicy authorizationPolicy;
    private final WorkspaceAuthorizationCache authorizationCache;
    private final TransactionRunner transactionRunner;
    private final AfterCommitExecutor afterCommitExecutor;
    private final Duration cacheTtl;

    public ResolveWorkspaceAccessUseCase(
            MembershipRepository membershipRepository,
            WorkspaceAuthorizationPolicy authorizationPolicy,
            WorkspaceAuthorizationCache authorizationCache,
            TransactionRunner transactionRunner,
            AfterCommitExecutor afterCommitExecutor,
            @Qualifier("workspaceAuthorizationCacheTtl") Duration cacheTtl) {
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.authorizationPolicy = Objects.requireNonNull(authorizationPolicy);
        this.authorizationCache = Objects.requireNonNull(authorizationCache);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.afterCommitExecutor = Objects.requireNonNull(afterCommitExecutor);
        this.cacheTtl = Objects.requireNonNull(cacheTtl, "cacheTtl must not be null");
        if (cacheTtl.isZero() || cacheTtl.isNegative()) {
            throw new IllegalArgumentException("cacheTtl must be positive");
        }
    }

    public WorkspaceAccessSnapshot execute(UUID workspaceId, UUID userId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(userId, "userId must not be null");

        Optional<WorkspaceAccessSnapshot> cached = readCache(workspaceId, userId);
        if (cached.isPresent()) {
            return cached.get();
        }

        Optional<String> generation = readGenerationForFill(workspaceId, userId);
        return transactionRunner.required(() -> {
            Membership membership = membershipRepository.findByWorkspaceIdAndUserId(workspaceId, userId)
                    .orElseThrow(() -> new MembershipNotFoundException(userId));
            WorkspaceAccessSnapshot snapshot = new WorkspaceAccessSnapshot(
                    workspaceId,
                    userId,
                    membership.getRole(),
                    authorizationPolicy.resolve(membership));
            if (generation.isPresent()) {
                afterCommitExecutor.execute(() -> {
                    try {
                        authorizationCache.putIfGenerationMatches(
                                snapshot,
                                cacheTtl,
                                generation.get());
                    } catch (RuntimeException exception) {
                        log.warn("Workspace authorization cache write failed for workspaceId={} userId={}",
                                workspaceId, userId);
                    }
                });
            }
            return snapshot;
        });
    }

    private Optional<String> readGenerationForFill(UUID workspaceId, UUID userId) {
        try {
            Optional<String> generation = authorizationCache.readGeneration(workspaceId, userId, cacheTtl);
            return generation == null ? Optional.empty() : generation;
        } catch (RuntimeException exception) {
            log.warn("Workspace authorization cache generation read failed for workspaceId={} userId={}",
                    workspaceId, userId);
            return Optional.empty();
        }
    }

    private Optional<WorkspaceAccessSnapshot> readCache(UUID workspaceId, UUID userId) {
        try {
            Optional<WorkspaceAccessSnapshot> cached = authorizationCache.get(workspaceId, userId);
            if (cached == null || cached.isEmpty()) {
                return Optional.empty();
            }
            WorkspaceAccessSnapshot snapshot = cached.get();
            if (!workspaceId.equals(snapshot.workspaceId())
                    || !userId.equals(snapshot.userId())
                    || !snapshot.hasValidAuthorizationSchema()) {
                log.warn("Workspace authorization cache entry rejected for workspaceId={} userId={}",
                        workspaceId, userId);
                return Optional.empty();
            }
            return Optional.of(snapshot);
        } catch (RuntimeException exception) {
            log.warn("Workspace authorization cache read failed for workspaceId={} userId={}",
                    workspaceId, userId);
            return Optional.empty();
        }
    }
}
