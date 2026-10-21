package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.AdminWorkspaceResponse;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.model.AdminWorkspaceRow;
import com.weav.workspace.domain.model.IdentityUserSummary;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.port.out.IdentityDirectoryPort;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.query.AdminWorkspaceQuery;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/** UC027: all active workspaces for system admins; the caller's role is checked at the HTTP edge. */
@Service
public final class ListAdminWorkspacesUseCase {

    private static final Logger log = LoggerFactory.getLogger(ListAdminWorkspacesUseCase.class);

    private final WorkspaceRepository workspaceRepository;
    private final IdentityDirectoryPort identityDirectory;
    private final TransactionRunner transactionRunner;

    public ListAdminWorkspacesUseCase(
            WorkspaceRepository workspaceRepository,
            IdentityDirectoryPort identityDirectory,
            TransactionRunner transactionRunner) {
        this.workspaceRepository = Objects.requireNonNull(workspaceRepository);
        this.identityDirectory = Objects.requireNonNull(identityDirectory);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
    }

    public PageResult<AdminWorkspaceResponse> execute(AdminWorkspaceQuery query) {
        Objects.requireNonNull(query, "query must not be null");
        PageResult<AdminWorkspaceRow> rows = transactionRunner.required(
                () -> workspaceRepository.findAllForAdmin(query));
        // Identity HTTP call runs with no transaction held; failure only blanks the owner fields.
        Map<UUID, IdentityUserSummary> owners = ownersById(rows.items());
        return new PageResult<>(
                rows.items().stream()
                        .map(row -> AdminWorkspaceResponse.from(row, owners.get(row.workspace().getCreatedBy())))
                        .toList(),
                rows.page(),
                rows.size(),
                rows.totalElements(),
                rows.totalPages());
    }

    private Map<UUID, IdentityUserSummary> ownersById(List<AdminWorkspaceRow> rows) {
        List<UUID> ownerIds = rows.stream().map(row -> row.workspace().getCreatedBy()).distinct().toList();
        if (ownerIds.isEmpty()) {
            return Map.of();
        }
        try {
            return identityDirectory.getUsersByIds(ownerIds).stream()
                    .collect(Collectors.toMap(IdentityUserSummary::userId, Function.identity(), (a, b) -> a));
        } catch (RuntimeException exception) {
            log.warn("Admin workspace owner lookup failed");
            return Map.of();
        }
    }
}
