package com.weav.workspace.application.usecase;

import com.weav.workspace.application.notification.ConnectionNotificationRecorder;
import com.weav.workspace.application.port.out.WorkspaceMutationLock;
import com.weav.workspace.application.dto.ConnectionAuthFailureCode;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import org.springframework.stereotype.Service;

import java.util.Objects;
import java.util.UUID;

/** Applies only a confirmed, typed authentication rejection reported over the future internal API. */
@Service
public final class ReportConnectionAuthFailureUseCase {

    private final ConnectionRepository connectionRepository;
    private final CredentialRepository credentialRepository;
    private final TransactionRunner transactionRunner;
    private final WorkspaceMutationLock workspaceMutationLock;
    private final ConnectionNotificationRecorder notificationRecorder;

    public ReportConnectionAuthFailureUseCase(
            ConnectionRepository connectionRepository,
            CredentialRepository credentialRepository,
            TransactionRunner transactionRunner,
            WorkspaceMutationLock workspaceMutationLock,
            ConnectionNotificationRecorder notificationRecorder) {
        this.connectionRepository = Objects.requireNonNull(connectionRepository);
        this.credentialRepository = Objects.requireNonNull(credentialRepository);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.workspaceMutationLock = Objects.requireNonNull(workspaceMutationLock);
        this.notificationRecorder = Objects.requireNonNull(notificationRecorder);
    }

    public void execute(UUID workspaceId, UUID connectionId, ConnectionAuthFailureCode failureCode) {
        execute(workspaceId, connectionId, failureCode, null, null);
    }

    public void execute(
            UUID workspaceId, UUID connectionId, ConnectionAuthFailureCode failureCode, UUID credentialId) {
        execute(workspaceId, connectionId, failureCode, credentialId, null);
    }

    /**
     * WS-11: when {@code credentialId} / {@code credentialVersion} (epoch-millis {@code updatedAt}) are
     * given and no longer match the current credential, it was replaced or rewritten since Workflow
     * resolved it, so the report is stale and ignored.
     */
    public void execute(
            UUID workspaceId,
            UUID connectionId,
            ConnectionAuthFailureCode failureCode,
            UUID credentialId,
            Long credentialVersion) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        if (failureCode != ConnectionAuthFailureCode.AUTHENTICATION_REJECTED) {
            throw new BadRequestException("Connection auth failure code is invalid");
        }
        transactionRunner.required(() -> {
            workspaceMutationLock.lock(workspaceId);
            Connection connection = connectionRepository.findByWorkspaceIdAndId(workspaceId, connectionId)
                    .orElseThrow(() -> new ResourceNotFoundException("Connection not found"));
            if ((credentialId != null || credentialVersion != null)
                    && !credentialRepository.findByConnectionIdForUpdate(connectionId)
                    .map(credential -> (credentialId == null || credential.getId().equals(credentialId))
                            && (credentialVersion == null
                            || credential.getUpdatedAt().toEpochMilli() == credentialVersion))
                    .orElse(false)) {
                return Boolean.TRUE;
            }
            if (connection.getStatus() == ConnectionStatus.ACTIVE) {
                connection.markInvalid();
                connectionRepository.save(connection);
                notificationRecorder.recordInvalid(connection, null);
            }
            return Boolean.TRUE;
        });
    }
}
