package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.WorkspaceResponse;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import org.springframework.stereotype.Service;

import java.util.Objects;
import java.util.UUID;

@Service
public final class GetWorkspaceUseCase {

    private final WorkspaceRepository workspaceRepository;
    private final MembershipRepository membershipRepository;
    private final TransactionRunner transactionRunner;

    public GetWorkspaceUseCase(
            WorkspaceRepository workspaceRepository,
            MembershipRepository membershipRepository,
            TransactionRunner transactionRunner) {
        this.workspaceRepository = Objects.requireNonNull(workspaceRepository);
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
    }

    public WorkspaceResponse execute(UUID actorUserId, UUID workspaceId) {
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        return transactionRunner.required(() -> {
            if (membershipRepository.findByWorkspaceIdAndUserId(workspaceId, actorUserId).isEmpty()) {
                throw new ResourceNotFoundException("Workspace not found", workspaceId);
            }
            return workspaceRepository.findById(workspaceId)
                    .map(WorkspaceResponse::from)
                    .orElseThrow(() -> new ResourceNotFoundException("Workspace not found", workspaceId));
        });
    }
}
