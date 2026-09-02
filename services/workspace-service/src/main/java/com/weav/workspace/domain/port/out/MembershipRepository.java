package com.weav.workspace.domain.port.out;

import com.weav.workspace.domain.model.Membership;
import java.util.Optional;
import java.util.UUID;

public interface MembershipRepository {
    Membership save(Membership membership);
    Optional<Membership> findById(UUID id);
    Optional<Membership> findByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);
}
