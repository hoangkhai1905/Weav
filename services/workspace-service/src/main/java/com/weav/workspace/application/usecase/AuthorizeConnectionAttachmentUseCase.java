package com.weav.workspace.application.usecase;

import com.weav.workspace.application.service.ConnectionAuthorizationPolicy;
import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.MembershipRepository;
import org.springframework.stereotype.Service;

import java.util.Objects;
import java.util.UUID;

/** Authorizes workflow attachment by workspace membership and OWNER/creator rights. */
@Service
public final class AuthorizeConnectionAttachmentUseCase {

    private final ConnectionRepository connectionRepository;
    private final MembershipRepository membershipRepository;
    private final ConnectionAuthorizationPolicy authorizationPolicy;

    public AuthorizeConnectionAttachmentUseCase(
            ConnectionRepository connectionRepository,
            MembershipRepository membershipRepository,
            ConnectionAuthorizationPolicy authorizationPolicy) {
        this.connectionRepository = Objects.requireNonNull(connectionRepository);
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.authorizationPolicy = Objects.requireNonNull(authorizationPolicy);
    }

    public void execute(UUID userId, UUID workspaceId, UUID connectionId) {
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");

        Connection connection = connectionRepository.findByWorkspaceIdAndId(workspaceId, connectionId)
                .orElseThrow(() -> new ResourceNotFoundException("Connection not found"));
        Membership membership = membershipRepository.findByWorkspaceIdAndUserId(workspaceId, userId)
                .orElseThrow(ForbiddenException::new);
        if (!membership.getUserId().equals(userId)
                || !authorizationPolicy.canAttach(membership, connection)) {
            throw new ForbiddenException();
        }
    }
}
