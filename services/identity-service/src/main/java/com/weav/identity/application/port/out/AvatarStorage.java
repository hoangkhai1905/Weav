package com.weav.identity.application.port.out;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

public interface AvatarStorage {

    String createObjectKey(UUID userId, String extension);

    void put(UUID userId, String objectKey, byte[] content, String contentType);

    SignedUrl createReadUrl(UUID userId, String objectKey, Duration lifetime);

    void delete(UUID userId, String objectKey);

    record SignedUrl(URI url, Instant expiresAt) {
    }
}
