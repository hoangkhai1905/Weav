package com.weav.workflow.application.trigger;

import com.weav.workflow.application.port.out.WebhookSecretPort;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import com.weav.workflow.domain.exception.WebhookNotFoundException;
import com.weav.workflow.domain.exception.WebhookRateLimitExceededException;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.TriggerType;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** WF-4: only authenticated callers spend the shared and per-endpoint budgets. */
class WebhookTriggerServiceRateLimitTest {
    private final WorkflowRepository workflows = mock(WorkflowRepository.class);
    private final WorkflowTriggerPort triggers = mock(WorkflowTriggerPort.class);
    private final WebhookSecretPort secrets = mock(WebhookSecretPort.class);
    private final ExecutionAdmissionService admissions = mock(ExecutionAdmissionService.class);

    private WebhookTriggerService service(int globalLimit, int endpointLimit) {
        return new WebhookTriggerService(workflows, triggers, secrets, admissions,
                new WebhookIngressRateLimiter(globalLimit, Duration.ofMinutes(1)),
                new WebhookEndpointRateLimiter(endpointLimit, Duration.ofMinutes(1)));
    }

    private void register(String endpointKey, String secret) {
        WorkflowTrigger trigger = WorkflowTrigger.createNew(UUID.randomUUID(), UUID.randomUUID(), "webhook",
                TriggerType.WEBHOOK, Map.of());
        trigger.provisionWebhook(endpointKey, "hash-of-" + secret);
        when(triggers.findWebhookByEndpoint(endpointKey)).thenReturn(Optional.of(trigger));
        when(secrets.matches(secret, "hash-of-" + secret)).thenReturn(true);
    }

    @Test
    void unknownKeysAndBadSecretsDoNotConsumeTheSharedBudget() {
        WebhookTriggerService service = service(2, 120);
        register("valid-endpoint", "good-secret");
        when(triggers.findWebhookByEndpoint("unknown")).thenReturn(Optional.empty());
        when(workflows.lockById(any(), any())).thenReturn(Optional.empty());

        for (int i = 0; i < 50; i++) {
            assertThrows(WebhookNotFoundException.class, () -> service.accept("unknown", "x", null, null, null));
            assertThrows(WebhookNotFoundException.class,
                    () -> service.accept("valid-endpoint", "wrong", null, null, null));
        }

        // The valid endpoint still has the full shared budget of 2: its requests reach the workflow
        // lookup (not found here) and only the third one is limited.
        assertThrows(WebhookNotFoundException.class,
                () -> service.accept("valid-endpoint", "good-secret", null, null, null));
        assertThrows(WebhookNotFoundException.class,
                () -> service.accept("valid-endpoint", "good-secret", null, null, null));
        assertThrows(WebhookRateLimitExceededException.class,
                () -> service.accept("valid-endpoint", "good-secret", null, null, null));
    }

    /** WF-14: a lock wait that exceeds the bound is shed as the retryable 429, not a 500. */
    @Test
    void lockTimeoutIsMappedToTheRetryableRateLimitError() {
        WebhookTriggerService service = service(1000, 1000);
        register("busy-endpoint", "busy-secret");
        when(workflows.lockById(any(), any()))
                .thenThrow(new org.springframework.dao.CannotAcquireLockException("lock timeout"));

        assertThrows(WebhookRateLimitExceededException.class,
                () -> service.accept("busy-endpoint", "busy-secret", null, null, null));
    }

    @Test
    void anEndpointIsLimitedOnItsOwnWithoutStarvingOthers() {
        WebhookTriggerService service = service(1000, 1);
        register("first-endpoint", "first-secret");
        register("other-endpoint", "other-secret");
        when(workflows.lockById(any(), any())).thenReturn(Optional.empty());

        assertThrows(WebhookNotFoundException.class,
                () -> service.accept("first-endpoint", "first-secret", null, null, null));
        assertThrows(WebhookRateLimitExceededException.class,
                () -> service.accept("first-endpoint", "first-secret", null, null, null));
        assertThrows(WebhookNotFoundException.class,
                () -> service.accept("other-endpoint", "other-secret", null, null, null));
    }
}
