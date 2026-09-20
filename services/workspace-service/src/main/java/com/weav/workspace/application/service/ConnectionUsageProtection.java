package com.weav.workspace.application.service;

import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkflowConnectionUsagePort;
import com.weav.workspace.domain.exception.ConflictException;
import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.exception.InvalidStateException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.valueobject.MembershipRole;

import java.util.Objects;
import java.util.UUID;
import java.util.function.BiFunction;

/**
 * Coordinates local authorization, the out-of-transaction Workflow usage
 * check, and the fresh transaction used by a state-changing operation.
 */
public final class ConnectionUsageProtection {

    private final ConnectionRepository connectionRepository;
    private final MembershipRepository membershipRepository;
    private final ConnectionAuthorizationPolicy authorizationPolicy;
    private final WorkflowConnectionUsagePort workflowConnectionUsagePort;
    private final TransactionRunner transactionRunner;

    public ConnectionUsageProtection(
            ConnectionRepository connectionRepository,
            MembershipRepository membershipRepository,
            ConnectionAuthorizationPolicy authorizationPolicy,
            WorkflowConnectionUsagePort workflowConnectionUsagePort,
            TransactionRunner transactionRunner) {
        this.connectionRepository = Objects.requireNonNull(connectionRepository);
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.authorizationPolicy = Objects.requireNonNull(authorizationPolicy);
        this.workflowConnectionUsagePort = Objects.requireNonNull(workflowConnectionUsagePort);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
    }

    public Authorization authorize(UUID actorUserId, UUID workspaceId, UUID connectionId) {
        assertNoAmbientTransaction();
        return transactionRunner.required(() -> {
            Membership membership = loadMembership(workspaceId, actorUserId);
            Connection connection = loadConnection(workspaceId, connectionId);
            assertCanManage(membership, connection);
            return new Authorization(workspaceId, connectionId, membership.getRole());
        });
    }

    /**
     * Performs the remote check after the local authorization transaction has
     * completed. A false result is advisory for the unavoidable cross-service
     * race between this check and the following local commit.
     */
    public void requireUnused(Authorization authorization, UsageScope scope) {
        Objects.requireNonNull(authorization, "authorization must not be null");
        Objects.requireNonNull(scope, "scope must not be null");
        if (scope == UsageScope.MEMBER_ONLY && authorization.role() != MembershipRole.MEMBER) {
            return;
        }
        if (workflowConnectionUsagePort.isInUse(
                authorization.workspaceId(), authorization.connectionId())) {
            throw new ConflictException("Connection is used by a workflow");
        }
    }

    public <T> T reauthorizeAndMutate(
            UUID actorUserId,
            UUID workspaceId,
            UUID connectionId,
            Authorization initialAuthorization,
            UsageScope scope,
            BiFunction<Membership, Connection, T> mutation) {
        assertNoAmbientTransaction();
        Objects.requireNonNull(initialAuthorization, "initialAuthorization must not be null");
        Objects.requireNonNull(scope, "scope must not be null");
        Objects.requireNonNull(mutation, "mutation must not be null");
        return transactionRunner.required(() -> {
            Membership membership = loadMembership(workspaceId, actorUserId);
            Connection connection = loadConnection(workspaceId, connectionId);
            assertCanManage(membership, connection);
            if (scope == UsageScope.MEMBER_ONLY
                    && initialAuthorization.role() == MembershipRole.OWNER
                    && membership.getRole() == MembershipRole.MEMBER) {
                throw new ConflictException("Connection management authorization changed");
            }
            return mutation.apply(membership, connection);
        });
    }

    private Membership loadMembership(UUID workspaceId, UUID actorUserId) {
        return membershipRepository.findByWorkspaceIdAndUserId(workspaceId, actorUserId)
                .orElseThrow(() -> new ResourceNotFoundException("Workspace not found", workspaceId));
    }

    private Connection loadConnection(UUID workspaceId, UUID connectionId) {
        return connectionRepository.findByWorkspaceIdAndId(workspaceId, connectionId)
                .orElseThrow(() -> new ResourceNotFoundException("Connection not found", connectionId));
    }

    private void assertCanManage(Membership membership, Connection connection) {
        if (!authorizationPolicy.canManageIgnoringUsage(membership, connection)) {
            throw new ForbiddenException();
        }
    }

    private void assertNoAmbientTransaction() {
        if (transactionRunner.hasAmbientTransaction()) {
            throw new InvalidStateException(
                    "Connection mutation requires a transaction-free orchestration boundary");
        }
    }

    public enum UsageScope {
        MEMBER_ONLY,
        ALL_ROLES
    }

    public record Authorization(UUID workspaceId, UUID connectionId, MembershipRole role) {
        public Authorization {
            Objects.requireNonNull(workspaceId, "workspaceId must not be null");
            Objects.requireNonNull(connectionId, "connectionId must not be null");
            Objects.requireNonNull(role, "role must not be null");
        }
    }
}
