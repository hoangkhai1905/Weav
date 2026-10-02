package com.weav.identity.application.dto;

import java.time.Instant;

public record AvatarUrlResult(String url, Instant expiresAt) {
}
