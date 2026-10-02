package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.AuthenticatedUserResult;
import com.weav.identity.application.dto.AvatarImage;
import com.weav.identity.application.port.out.AvatarCleanupQueue;
import com.weav.identity.application.port.out.AvatarStorage;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.application.validation.AvatarImageValidator;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Clock;
import java.util.Objects;
import java.util.UUID;

public final class UpdateAvatarUseCase {

    private static final Logger log = LoggerFactory.getLogger(UpdateAvatarUseCase.class);
    private static final String AUTHENTICATION_FAILED = "Authentication failed";

    private final CurrentIdentityGuard identityGuard;
    private final UserRepository userRepository;
    private final AvatarStorage avatarStorage;
    private final AvatarCleanupQueue cleanupReconciler;
    private final AvatarImageValidator imageValidator;
    private final TransactionRunner transactionRunner;
    private final Clock clock;

    public UpdateAvatarUseCase(
            CurrentIdentityGuard identityGuard,
            UserRepository userRepository,
            AvatarStorage avatarStorage,
            AvatarCleanupQueue cleanupReconciler,
            AvatarImageValidator imageValidator,
            TransactionRunner transactionRunner,
            Clock clock
    ) {
        this.identityGuard = Objects.requireNonNull(identityGuard);
        this.userRepository = Objects.requireNonNull(userRepository);
        this.avatarStorage = Objects.requireNonNull(avatarStorage);
        this.cleanupReconciler = Objects.requireNonNull(cleanupReconciler);
        this.imageValidator = Objects.requireNonNull(imageValidator);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.clock = Objects.requireNonNull(clock);
    }

    public AuthenticatedUserResult execute(
            UUID userId,
            UUID sessionId,
            byte[] input,
            String declaredContentType
    ) {
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        identityGuard.requireActiveUser(userId, sessionId);

        AvatarImage image = imageValidator.normalize(input, declaredContentType);
        String newObjectKey = avatarStorage.createObjectKey(userId, image.extension());
        try {
            avatarStorage.put(userId, newObjectKey, image.content(), image.contentType());
        } catch (RuntimeException storageFailure) {
            cleanupNewObject(userId, newObjectKey);
            throw storageFailure;
        }

        AuthenticatedUserResult mutation;
        try {
            mutation = transactionRunner.required(() -> {
                User lockedUser = userRepository.findByIdForUpdate(userId)
                        .orElseThrow(() -> new UnauthorizedException(AUTHENTICATION_FAILED));
                identityGuard.requireActiveSessionForLockedUser(lockedUser, userId, sessionId);
                String previousObjectKey = lockedUser.getAvatarStorageKey();
                lockedUser.replaceAvatarStorageKey(newObjectKey, clock.instant());
                AuthenticatedUserResult result = AuthenticatedUserResult.from(userRepository.save(lockedUser));
                // ID-7: the durable cleanup row commits or rolls back with the key swap.
                if (previousObjectKey != null && !previousObjectKey.isBlank()
                        && !previousObjectKey.equals(newObjectKey)) {
                    cleanupReconciler.enqueue(userId, previousObjectKey);
                }
                return result;
            });
        } catch (RuntimeException databaseFailure) {
            cleanupNewObject(userId, newObjectKey);
            throw databaseFailure;
        }
        return mutation;
    }

    private void cleanupNewObject(UUID userId, String objectKey) {
        try {
            avatarStorage.delete(userId, objectKey);
        } catch (RuntimeException cleanupFailure) {
            cleanupReconciler.enqueue(userId, objectKey);
            log.warn("identity_avatar_cleanup_event userId={} action=DELETE_NEW result=RETRYABLE",
                    userId);
        }
    }
}
