package com.weav.workflow.application.trigger;

import com.weav.workflow.application.port.out.ExecutionAdmissionPort;
import com.weav.workflow.application.port.out.WebhookSecretPort;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import com.weav.workflow.domain.exception.IdempotencyKeyReusedException;
import com.weav.workflow.domain.exception.WebhookNotFoundException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.Optional;

/** Authenticates a webhook registration and atomically admits its durable execution. */
@Service
public class WebhookTriggerService {
    private static final java.time.Duration LOCK_TIMEOUT = java.time.Duration.ofSeconds(2);

    private final WorkflowRepository workflows;
    private final WorkflowTriggerPort triggers;
    private final WebhookSecretPort secrets;
    private final ExecutionAdmissionService admissions;
    private final WebhookIngressRateLimiter rateLimiter;
    private final WebhookEndpointRateLimiter endpointLimiter;

    public WebhookTriggerService(WorkflowRepository workflows, WorkflowTriggerPort triggers,
                                 WebhookSecretPort secrets, ExecutionAdmissionService admissions,
                                 WebhookIngressRateLimiter rateLimiter,
                                 WebhookEndpointRateLimiter endpointLimiter) {
        this.workflows = Objects.requireNonNull(workflows, "workflows must not be null");
        this.triggers = Objects.requireNonNull(triggers, "triggers must not be null");
        this.secrets = Objects.requireNonNull(secrets, "secrets must not be null");
        this.admissions = Objects.requireNonNull(admissions, "admissions must not be null");
        this.rateLimiter = Objects.requireNonNull(rateLimiter, "rateLimiter must not be null");
        this.endpointLimiter = Objects.requireNonNull(endpointLimiter, "endpointLimiter must not be null");
    }

    public ExecutionAdmissionPort.Admission accept(String endpointKey, String suppliedSecret, Object input,
                                                    String correlationId, String traceparent) {
        return accept(endpointKey, suppliedSecret, input, correlationId, traceparent, null);
    }

    @Transactional
    public ExecutionAdmissionPort.Admission accept(String endpointKey, String suppliedSecret, Object input,
                                                    String correlationId, String traceparent,
                                                    String idempotencyKey) {
        Optional<WorkflowTrigger> candidate = endpointKey == null
                ? Optional.empty()
                : triggers.findWebhookByEndpoint(endpointKey);
        WorkflowTrigger identity = authenticate(candidate, suppliedSecret);
        return admit(identity, TriggerType.WEBHOOK, endpointKey, suppliedSecret, input,
                correlationId, traceparent, idempotencyKey);
    }

    /**
     * Telegram ingress: same authentication and admission as a webhook, but only for TELEGRAM triggers, with the
     * secret taken from X-Telegram-Bot-Api-Secret-Token and {@code telegram:<update_id>} as idempotency key.
     * Empty means the caller is authentic but there is nothing to run (no text message, or a redelivery).
     */
    @Transactional
    public Optional<ExecutionAdmissionPort.Admission> acceptTelegram(
            String endpointKey, String suppliedSecret, Object update, String correlationId, String traceparent) {
        Optional<WorkflowTrigger> candidate = endpointKey == null
                ? Optional.empty()
                : triggers.findTelegramByEndpoint(endpointKey);
        WorkflowTrigger identity = authenticate(candidate, suppliedSecret);
        Optional<TelegramUpdate> parsed = TelegramUpdate.from(update);
        if (parsed.isEmpty()) {
            return Optional.empty();
        }
        try {
            return Optional.of(admit(identity, TriggerType.TELEGRAM, endpointKey, suppliedSecret,
                    parsed.get().input(), correlationId, traceparent, parsed.get().idempotencyKey()));
        } catch (IdempotencyKeyReusedException duplicate) {
            return Optional.empty();
        }
    }

    /** Always runs the constant-time comparison, against a dummy hash for unknown keys. */
    private WorkflowTrigger authenticate(Optional<WorkflowTrigger> candidate, String suppliedSecret) {
        String storedHash = candidate.map(WorkflowTrigger::getSecretHash)
                .orElse(WebhookSecretPort.UNKNOWN_HASH);
        boolean credentialMatches = secrets.matches(suppliedSecret, storedHash);
        if (candidate.isEmpty() || !credentialMatches) {
            throw new WebhookNotFoundException();
        }
        return candidate.get();
    }

    private ExecutionAdmissionPort.Admission admit(WorkflowTrigger identity, TriggerType expectedType,
                                                    String endpointKey, String suppliedSecret, Object input,
                                                    String correlationId, String traceparent,
                                                    String idempotencyKey) {
        // Budgets are spent only by authenticated callers: unknown keys and bad secrets cannot starve tenants.
        if (!endpointLimiter.tryAcquire(identity.getId()) || !rateLimiter.tryAcquire()) {
            throw new com.weav.workflow.domain.exception.WebhookRateLimitExceededException();
        }
        try {
            // WF-14: the write lock stays. Admission re-takes it to serialise idempotent replays and to persist,
            // so a shared lock here would deadlock two concurrent hits on the share-to-exclusive upgrade.
            // A bounded lock wait (set for the whole transaction) sheds contention instead of piling up requests.
            Workflow workflow = workflows.lockById(identity.getWorkflowId(), LOCK_TIMEOUT)
                    .orElseThrow(WebhookNotFoundException::new);
            WorkflowTrigger registration = triggers.lockCurrent(identity.getWorkflowId(), identity.getId())
                    .orElseThrow(WebhookNotFoundException::new);
            if (workflow.getDeletedAt() != null || workflow.getStatus() != WorkflowStatus.PUBLISHED
                    || workflow.getCurrentVersionId() == null
                    || !workflow.getCurrentVersionId().equals(registration.getWorkflowVersionId())
                    || registration.getType() != expectedType
                    || registration.getStatus() != TriggerStatus.ACTIVE
                    || !endpointKey.equals(registration.getEndpointKey())
                    || !secrets.matches(suppliedSecret, registration.getSecretHash())) {
                throw new WebhookNotFoundException();
            }

            // The admission adapter repeats the published/active/version checks under these same locks,
            // then commits execution rows and outbox intent before this transaction can return.
            return admissions.automatic(registration.getId(), input, null, correlationId, traceparent,
                    idempotencyKey);
        } catch (PessimisticLockingFailureException timeout) {
            // Lock wait exceeded: same retryable 429 (with Retry-After) as an exhausted ingress budget.
            throw new com.weav.workflow.domain.exception.WebhookRateLimitExceededException();
        }
    }
}
