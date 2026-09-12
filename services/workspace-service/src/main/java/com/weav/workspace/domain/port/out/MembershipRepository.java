package com.weav.workspace.domain.port.out;

import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.query.MemberListQuery;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface MembershipRepository {
    Membership save(Membership membership);
    Optional<Membership> findById(UUID id);
    Optional<Membership> findByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);
    boolean existsByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);
    List<Membership> findCandidates(UUID workspaceId, MemberListQuery filter);
    PageResult<Membership> pageCandidatesByWorkspaceOwnedSort(
            UUID workspaceId,
            MemberListQuery query,
            Collection<UUID> matchedUserIds);
    void delete(Membership membership);
}
