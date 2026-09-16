package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.AvatarUrlResult;
import com.weav.identity.application.port.out.AvatarStorage;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.domain.exception.ResourceNotFoundException;
import com.weav.identity.domain.model.User;

import java.time.Duration;
import java.util.Objects;
import java.util.UUID;

public final class GetAvatarUseCase {

    private final CurrentIdentityGuard identityGuard;
    private final AvatarStorage avatarStorage;
    private final Duration signedUrlTtl;

    public GetAvatarUseCase(
            CurrentIdentityGuard identityGuard,
            AvatarStorage avatarStorage,
            Duration signedUrlTtl
    ) {
        this.identityGuard = Objects.requireNonNull(identityGuard);
        this.avatarStorage = Objects.requireNonNull(avatarStorage);
        this.signedUrlTtl = Objects.requireNonNull(signedUrlTtl);
    }

    public AvatarUrlResult execute(UUID userId, UUID sessionId) {
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        User user = identityGuard.requireActiveUser(userId, sessionId);
        String objectKey = user.getAvatarStorageKey();
        if (objectKey == null || objectKey.isBlank()) {
            throw new ResourceNotFoundException("Avatar not found");
        }
        AvatarStorage.SignedUrl signedUrl = avatarStorage.createReadUrl(userId, objectKey, signedUrlTtl);
        return new AvatarUrlResult(signedUrl.url().toString(), signedUrl.expiresAt());
    }
}
