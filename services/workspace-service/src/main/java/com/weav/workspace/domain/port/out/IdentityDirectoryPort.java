package com.weav.workspace.domain.port.out;

import com.weav.workspace.domain.model.IdentityUserSummary;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.query.SortDirection;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

public interface IdentityDirectoryPort {

    Optional<IdentityUserSummary> findByEmail(String normalizedEmail);

    Set<UUID> matchUserIds(Collection<UUID> candidateUserIds, String search);

    PageResult<IdentityUserSummary> searchUsersByDisplayName(
            Collection<UUID> candidateUserIds,
            String search,
            int page,
            int size,
            SortDirection direction);

    List<IdentityUserSummary> getUsersByIds(Collection<UUID> userIds);
}
