package com.weav.identity.presentation.http.response;

import java.time.Instant;
import java.util.UUID;

public record SessionResponse(
        UUID id,
        Instant createdAt,
        Instant lastUsedAt,
        Instant expiresAt,
        boolean current,
        String userAgent
) {
}
