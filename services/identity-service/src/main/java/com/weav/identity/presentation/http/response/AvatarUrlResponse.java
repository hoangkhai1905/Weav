package com.weav.identity.presentation.http.response;

import java.time.Instant;

public record AvatarUrlResponse(String url, Instant expiresAt) {
}
