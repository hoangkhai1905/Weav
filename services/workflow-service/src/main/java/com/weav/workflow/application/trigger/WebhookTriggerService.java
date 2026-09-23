package com.weav.workflow.application.trigger;

import com.weav.workflow.application.port.out.ExecutionAdmissionPort;
import com.weav.workflow.application.port.out.WebhookSecretPort;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import com.weav.workflow.domain.exception.WebhookNotFoundException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.Optional;

/** Authenticates a webhook registration and atomically admits its durable execution. */
@Service
public class WebhookTriggerService {
    private final WorkflowRepository workflows;
    private final WorkflowTriggerPort triggers;
    private final WebhookSecretPort secrets;
    private final ExecutionAdmissionService admissions;
    private final WebhookIngressRateLimiter rateLimiter;

    public WebhookTriggerService(WorkflowRepository workflows, WorkflowTriggerPort triggers,
                                 WebhookSecretPort secrets, ExecutionAdmissionService admissions,
                                 WebhookIngressRateLimiter rateLimiter) {
        this.workflows = Objects.requireNonNull(workflows, "workflows must not be null");
        this.triggers = Objects.requireNonNull(triggers, "triggers must not be null");
        this.secrets = Objects.requireNonNull(secrets, "secrets must not be null");
        this.admissions = Objects.requireNonNull(admissions, "admissions must not be null");
        this.rateLimiter = Objects.requireNonNull(rateLimiter, "rateLimiter must not be null");
    }

    @Transactional
    public ExecutionAdmissionPort.Admission accept(String endpointKey, String suppliedSecret, Object input,
                                                    String correlationId, String traceparent) {
        if (!rateLimiter.tryAcquire()) {
            throw new com.weav.workflow.domain.exception.WebhookRateLimitExceededException();
        }

        Optional<WorkflowTrigger> candidate = endpointKey == null
                ? Optional.empty()
                : triggers.findWebhookByEndpoint(endpointKey);
        String storedHash = candidate.map(WorkflowTrigger::getSecretHash)
                .orElse(WebhookSecretPort.UNKNOWN_HASH);
        boolean credentialMatches = secrets.matches(suppliedSecret, storedHash);
        if (candidate.isEmpty() || !credentialMatches) {
            throw new WebhookNotFoundException();
        }

        WorkflowTrigger identity = candidate.get();
        Workflow workflow = workflows.lockById(identity.getWorkflowId())
                .orElseThrow(WebhookNotFoundException::new);
        WorkflowTrigger registration = triggers.lockCurrent(identity.getWorkflowId(), identity.getId())
                .orElseThrow(WebhookNotFoundException::new);
        if (workflow.getDeletedAt() != null || workflow.getStatus() != WorkflowStatus.PUBLISHED
                || workflow.getCurrentVersionId() == null
                || !workflow.getCurrentVersionId().equals(registration.getWorkflowVersionId())
                || registration.getType() != TriggerType.WEBHOOK
                || registration.getStatus() != TriggerStatus.ACTIVE
                || !endpointKey.equals(registration.getEndpointKey())
                || !secrets.matches(suppliedSecret, registration.getSecretHash())) {
            throw new WebhookNotFoundException();
        }

        // The admission adapter repeats the published/active/version checks under these same locks,
        // then commits execution rows and outbox intent before this transaction can return.
        return admissions.automatic(registration.getId(), input, null, correlationId, traceparent);
    }
}
