package com.weav.identity.application.usecase;

import com.weav.identity.application.port.out.AvatarStorage;
import com.weav.identity.application.port.out.AvatarCleanupQueue;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Clock;
import java.util.Objects;
import java.util.UUID;

public final class DeleteAvatarUseCase {

    private static final Logger log = LoggerFactory.getLogger(DeleteAvatarUseCase.class);
    private static final String AUTHENTICATION_FAILED = "Authentication failed";

    private final CurrentIdentityGuard identityGuard;
    private final UserRepository userRepository;
    private final AvatarStorage avatarStorage;
    private final AvatarCleanupQueue cleanupReconciler;
    private final TransactionRunner transactionRunner;
    private final Clock clock;

    public DeleteAvatarUseCase(
            CurrentIdentityGuard identityGuard,
            UserRepository userRepository,
            AvatarStorage avatarStorage,
            AvatarCleanupQueue cleanupReconciler,
            TransactionRunner transactionRunner,
            Clock clock
    ) {
        this.identityGuard = Objects.requireNonNull(identityGuard);
        this.userRepository = Objects.requireNonNull(userRepository);
        this.avatarStorage = Objects.requireNonNull(avatarStorage);
        this.cleanupReconciler = Objects.requireNonNull(cleanupReconciler);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.clock = Objects.requireNonNull(clock);
    }

    public void execute(UUID userId, UUID sessionId) {
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        identityGuard.requireActiveUser(userId, sessionId);

        String previousObjectKey = transactionRunner.required(() -> {
            User lockedUser = userRepository.findByIdForUpdate(userId)
                    .orElseThrow(() -> new UnauthorizedException(AUTHENTICATION_FAILED));
            identityGuard.requireActiveSessionForLockedUser(lockedUser, userId, sessionId);
            String oldObjectKey = lockedUser.getAvatarStorageKey();
            if (oldObjectKey != null && !oldObjectKey.isBlank()) {
                lockedUser.clearAvatarStorageKey(clock.instant());
                userRepository.save(lockedUser);
            }
            return oldObjectKey;
        });

        if (previousObjectKey == null || previousObjectKey.isBlank()) {
            return;
        }
        try {
            avatarStorage.delete(userId, previousObjectKey);
        } catch (RuntimeException cleanupFailure) {
            cleanupReconciler.enqueue(userId, previousObjectKey);
            log.warn("identity_avatar_cleanup_event userId={} action=DELETE_OLD result=RETRYABLE",
                    userId);
        }
    }
}
