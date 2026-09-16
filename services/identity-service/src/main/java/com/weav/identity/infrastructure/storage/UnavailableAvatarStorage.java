package com.weav.identity.infrastructure.storage;

import com.weav.identity.application.port.out.AvatarStorage;
import com.weav.identity.domain.exception.DependencyUnavailableException;

import java.time.Duration;
import java.util.UUID;

public final class UnavailableAvatarStorage implements AvatarStorage {

    @Override
    public String createObjectKey(UUID userId, String extension) {
        return "avatars/" + userId + "/" + UUID.randomUUID() + "." + extension;
    }

    @Override
    public void put(UUID userId, String objectKey, byte[] content, String contentType) {
        throw new DependencyUnavailableException();
    }

    @Override
    public SignedUrl createReadUrl(UUID userId, String objectKey, Duration lifetime) {
        throw new DependencyUnavailableException();
    }

    @Override
    public void delete(UUID userId, String objectKey) {
        throw new DependencyUnavailableException();
    }
}
