package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.ConnectionAuthFailureCode;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import org.springframework.stereotype.Service;

import java.util.Objects;
import java.util.UUID;

/** Applies only a confirmed, typed authentication rejection reported over the future internal API. */
@Service
public final class ReportConnectionAuthFailureUseCase {

    private final ConnectionRepository connectionRepository;
    private final TransactionRunner transactionRunner;

    public ReportConnectionAuthFailureUseCase(
            ConnectionRepository connectionRepository,
            TransactionRunner transactionRunner) {
        this.connectionRepository = Objects.requireNonNull(connectionRepository);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
    }

    public void execute(
            UUID workspaceId,
            UUID connectionId,
            ConnectionAuthFailureCode failureCode) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        if (failureCode != ConnectionAuthFailureCode.AUTHENTICATION_REJECTED) {
            throw new BadRequestException("Connection auth failure code is invalid");
        }
        transactionRunner.required(() -> {
            Connection connection = connectionRepository.findByWorkspaceIdAndId(workspaceId, connectionId)
                    .orElseThrow(() -> new ResourceNotFoundException("Connection not found"));
            if (connection.getStatus() == ConnectionStatus.ACTIVE) {
                connection.markInvalid();
                connectionRepository.save(connection);
            }
            return Boolean.TRUE;
        });
    }
}
