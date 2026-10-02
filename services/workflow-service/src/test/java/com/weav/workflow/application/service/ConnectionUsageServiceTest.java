package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.ConnectionReferencePort;
import com.weav.workflow.domain.exception.RateLimitExceededException;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ConnectionUsageServiceTest {

    @Test
    void returnsTheScopedReferenceAnswerWithoutLookingUpConnectionExistence() {
        ConnectionReferencePort references = mock(ConnectionReferencePort.class);
        UUID workspaceId = UUID.randomUUID();
        UUID neverObservedConnectionId = UUID.randomUUID();
        when(references.inUse(workspaceId, neverObservedConnectionId)).thenReturn(false);
        ConnectionUsageService service = new ConnectionUsageService(
                references, new ConnectionUsageRateLimiter(5, Duration.ofMinutes(1), () -> 0L));

        assertFalse(service.lookup(workspaceId, neverObservedConnectionId));

        verify(references).inUse(workspaceId, neverObservedConnectionId);
    }

    @Test
    void rejectsAnOverLimitLookupBeforeTouchingTheReferenceStore() {
        ConnectionReferencePort references = mock(ConnectionReferencePort.class);
        ConnectionUsageService service = new ConnectionUsageService(
                references, new ConnectionUsageRateLimiter(1, Duration.ofMinutes(1), () -> 0L));
        UUID workspaceId = UUID.randomUUID();
        UUID connectionId = UUID.randomUUID();

        assertFalse(service.lookup(workspaceId, connectionId));
        assertThrows(RateLimitExceededException.class, () -> service.lookup(workspaceId, connectionId));

        verify(references).inUse(workspaceId, connectionId);
    }
}
