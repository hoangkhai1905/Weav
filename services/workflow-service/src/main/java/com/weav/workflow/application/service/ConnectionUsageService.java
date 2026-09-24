package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.ConnectionReferencePort;
import com.weav.workflow.domain.exception.RateLimitExceededException;
import org.springframework.stereotype.Service;

import java.util.Objects;
import java.util.UUID;

/** Answers only Workflow's scoped reference question; Workspace owns connection existence. */
@Service
public final class ConnectionUsageService {

    private final ConnectionReferencePort connectionReferences;
    private final ConnectionUsageRateLimiter rateLimiter;

    public ConnectionUsageService(
            ConnectionReferencePort connectionReferences,
            ConnectionUsageRateLimiter rateLimiter) {
        this.connectionReferences = Objects.requireNonNull(
                connectionReferences, "connectionReferences must not be null");
        this.rateLimiter = Objects.requireNonNull(rateLimiter, "rateLimiter must not be null");
    }

    public boolean lookup(UUID workspaceId, UUID connectionId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        if (!rateLimiter.tryAcquire()) {
            throw new RateLimitExceededException();
        }
        return connectionReferences.inUse(workspaceId, connectionId);
    }
}
