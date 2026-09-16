package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.AddMemberCommand;
import com.weav.workspace.application.dto.MemberView;
import com.weav.workspace.application.port.out.AfterCommitExecutor;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.validation.IdentityEmailNormalizer;
import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.exception.UserAlreadyMemberException;
import com.weav.workspace.domain.exception.UserInactiveException;
import com.weav.workspace.domain.exception.UserNotFoundException;
import com.weav.workspace.domain.model.IdentityUserSummary;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.port.out.IdentityDirectoryPort;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceAuthorizationCache;
import com.weav.workspace.domain.valueobject.MembershipRole;
import org.springframework.stereotype.Service;

import java.util.Objects;

@Service
public final class AddMemberUseCase {

    private final MembershipRepository membershipRepository;
    private final IdentityDirectoryPort identityDirectory;
    private final TransactionRunner transactionRunner;
    private final AfterCommitExecutor afterCommitExecutor;
    private final WorkspaceAuthorizationCache authorizationCache;

    public AddMemberUseCase(
            MembershipRepository membershipRepository,
            IdentityDirectoryPort identityDirectory,
            TransactionRunner transactionRunner,
            AfterCommitExecutor afterCommitExecutor,
            WorkspaceAuthorizationCache authorizationCache) {
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.identityDirectory = Objects.requireNonNull(identityDirectory);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.afterCommitExecutor = Objects.requireNonNull(afterCommitExecutor);
        this.authorizationCache = Objects.requireNonNull(authorizationCache);
    }

    public MemberView execute(AddMemberCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        return transactionRunner.required(() -> {
            Membership actor = membershipRepository.findByWorkspaceIdAndUserId(
                            command.workspaceId(), command.actorUserId())
                    .orElseThrow(() -> new ResourceNotFoundException(
                            "Workspace not found", command.workspaceId()));
            if (actor.getRole() != MembershipRole.OWNER) {
                throw new ForbiddenException();
            }

            String email = IdentityEmailNormalizer.canonicalize(command.email());
            IdentityUserSummary summary = identityDirectory.findByEmail(email)
                    .orElseThrow(UserNotFoundException::new);
            if (!summary.active()) {
                throw new UserInactiveException();
            }
            if (membershipRepository.existsByWorkspaceIdAndUserId(
                    command.workspaceId(), summary.userId())) {
                throw new UserAlreadyMemberException();
            }

            Membership saved = membershipRepository.save(
                    Membership.member(command.workspaceId(), summary.userId()));
            afterCommitExecutor.execute(() -> authorizationCache.evict(
                    command.workspaceId(), summary.userId()));
            return MemberView.from(saved, summary);
        });
    }
}
