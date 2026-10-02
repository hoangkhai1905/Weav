package com.weav.workflow.infrastructure.messaging;

import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.application.port.out.WorkflowNotificationOutboxStore;
import com.weav.workflow.application.port.out.WorkflowNotificationOutboxStore.ClaimedEvent;
import com.weav.workflow.domain.exception.ForbiddenException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.amqp.rabbit.core.RabbitTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WorkflowNotificationOutboxPublisherTest {
    private static final Instant NOW = Instant.parse("2026-09-27T12:00:00Z");
    private static final UUID EVENT_ID = UUID.randomUUID();
    private static final UUID CLAIM_TOKEN = UUID.randomUUID();
    private static final UUID WORKSPACE_ID = UUID.randomUUID();
    private static final UUID RECIPIENT_ID = UUID.randomUUID();
    private static final ClaimedEvent EVENT = new ClaimedEvent(EVENT_ID, "workflow.completed", WORKSPACE_ID,
            RECIPIENT_ID, true, "{}", CLAIM_TOKEN, 0);

    @Mock
    private WorkflowNotificationOutboxStore outbox;
    @Mock
    private WorkspaceAccessPort workspaceAccess;
    @Mock
    private RabbitTemplate rabbitTemplate;

    private WorkflowNotificationOutboxPublisher publisher;

    @BeforeEach
    void setUp() {
        publisher = new WorkflowNotificationOutboxPublisher(outbox, workspaceAccess, rabbitTemplate,
                Clock.fixed(NOW, ZoneOffset.UTC), 25, Duration.ofSeconds(30), Duration.ofSeconds(5),
                Duration.ofSeconds(60), "weav.events");
        when(outbox.claim(25, Duration.ofSeconds(30))).thenReturn(List.of(EVENT));
    }

    @Test
    void deniedRecipientIsSkippedWithoutPublishing() {
        doThrow(new ForbiddenException()).when(workspaceAccess).getAccess(WORKSPACE_ID, RECIPIENT_ID);

        publisher.publishPending();

        verify(outbox).markSkipped(EVENT_ID, CLAIM_TOKEN, "ACCESS_DENIED", NOW);
        verifyNoInteractions(rabbitTemplate);
    }

    @Test
    void missingMonitorCapabilityIsSkippedWithoutPublishing() {
        when(workspaceAccess.getAccess(WORKSPACE_ID, RECIPIENT_ID)).thenReturn(
                new WorkspaceAccessPort.Access(WORKSPACE_ID, RECIPIENT_ID, "MEMBER", Set.of("WORKSPACE_VIEW")));

        publisher.publishPending();

        verify(outbox).markSkipped(EVENT_ID, CLAIM_TOKEN, "MISSING_WORKFLOW_MONITOR", NOW);
        verifyNoInteractions(rabbitTemplate);
    }

    @Test
    void mismatchedWorkspaceIdentityRetriesWithoutPublishing() {
        when(workspaceAccess.getAccess(WORKSPACE_ID, RECIPIENT_ID)).thenReturn(
                new WorkspaceAccessPort.Access(UUID.randomUUID(), RECIPIENT_ID, "MEMBER", Set.of("WORKFLOW_MONITOR")));

        publisher.publishPending();

        verify(outbox).scheduleRetry(EVENT_ID, CLAIM_TOKEN, "ACCESS_INVALID",
                NOW.plusMillis(250), NOW);
        verifyNoInteractions(rabbitTemplate);
    }

    @Test
    void unavailableWorkspaceRetriesWithoutPublishingOrChangingExecution() {
        doThrow(new WorkspaceDependencyUnavailableException())
                .when(workspaceAccess).getAccess(WORKSPACE_ID, RECIPIENT_ID);

        publisher.publishPending();

        verify(outbox).scheduleRetry(EVENT_ID, CLAIM_TOKEN, "ACCESS_UNAVAILABLE",
                NOW.plusMillis(250), NOW);
        verifyNoInteractions(rabbitTemplate);
    }
}
