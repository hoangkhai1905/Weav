package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.AdminUserResult;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.domain.exception.ResourceNotFoundException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;

import java.util.Objects;
import java.util.UUID;

public final class GetUserDetailUseCase {

    private final CurrentIdentityGuard identityGuard;
    private final UserRepository userRepository;
    private final TransactionRunner transactionRunner;

    public GetUserDetailUseCase(
            CurrentIdentityGuard identityGuard,
            UserRepository userRepository,
            TransactionRunner transactionRunner
    ) {
        this.identityGuard = Objects.requireNonNull(identityGuard);
        this.userRepository = Objects.requireNonNull(userRepository);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
    }

    public AdminUserResult execute(UUID actorId, UUID sessionId, UUID targetUserId) {
        Objects.requireNonNull(actorId, "actorId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        Objects.requireNonNull(targetUserId, "targetUserId must not be null");

        return transactionRunner.required(() -> {
            User actor = userRepository.findByIdForUpdate(actorId).orElse(null);
            identityGuard.requireActiveAdminForLockedUser(actor, actorId, sessionId);
            User target = userRepository.findById(targetUserId)
                    .orElseThrow(() -> new ResourceNotFoundException("Resource not found"));
            return AdminUserResult.from(target);
        });
    }
}
