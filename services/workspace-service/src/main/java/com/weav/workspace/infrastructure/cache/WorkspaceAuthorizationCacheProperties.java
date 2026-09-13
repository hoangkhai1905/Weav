package com.weav.workspace.infrastructure.cache;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "weav.workspace.authorization-cache")
public record WorkspaceAuthorizationCacheProperties(Duration ttl) {

    public WorkspaceAuthorizationCacheProperties {
        ttl = ttl == null ? Duration.ofMinutes(5) : ttl;
        if (ttl.isZero() || ttl.isNegative()) {
            throw new IllegalArgumentException("authorization cache ttl must be positive");
        }
    }
}
