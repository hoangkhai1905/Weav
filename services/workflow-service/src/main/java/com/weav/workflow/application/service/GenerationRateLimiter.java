package com.weav.workflow.application.service;

import org.springframework.stereotype.Component;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Component
public final class GenerationRateLimiter {
    private static final int MAX_KEYS = 10_000;
    private final ConcurrentHashMap<String, ConnectionUsageRateLimiter> windows = new ConcurrentHashMap<>();

    public boolean tryAcquire(UUID actorId, UUID workspaceId) {
        if (windows.size() > MAX_KEYS) {
            windows.clear();
        }
        return windows.computeIfAbsent(actorId + ":" + workspaceId,
                key -> new ConnectionUsageRateLimiter(5, Duration.ofMinutes(1), System::nanoTime)).tryAcquire();
    }
}
