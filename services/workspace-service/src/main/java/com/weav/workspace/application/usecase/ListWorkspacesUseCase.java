package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.WorkspaceResponse;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.query.WorkspaceListQuery;
import org.springframework.stereotype.Service;

import java.util.Objects;

@Service
public final class ListWorkspacesUseCase {

    private final WorkspaceRepository workspaceRepository;
    private final TransactionRunner transactionRunner;

    public ListWorkspacesUseCase(
            WorkspaceRepository workspaceRepository,
            TransactionRunner transactionRunner) {
        this.workspaceRepository = Objects.requireNonNull(workspaceRepository);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
    }

    public PageResult<WorkspaceResponse> execute(
            java.util.UUID actorUserId,
            WorkspaceListQuery query) {
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
        Objects.requireNonNull(query, "query must not be null");
        return transactionRunner.required(() -> {
            PageResult<com.weav.workspace.domain.model.WorkspaceMembershipView> result =
                    workspaceRepository.findAccessibleWorkspaces(actorUserId, query);
            return new PageResult<>(
                    result.items().stream().map(view -> WorkspaceResponse.from(view.workspace())).toList(),
                    result.page(),
                    result.size(),
                    result.totalElements(),
                    result.totalPages());
        });
    }
}
