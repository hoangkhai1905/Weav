package com.weav.identity.application.dto;

import java.time.Instant;
import java.util.UUID;

public record SessionResult(
        UUID id,
        Instant createdAt,
        Instant lastUsedAt,
        Instant expiresAt,
        boolean current,
        String userAgent
) {
}
