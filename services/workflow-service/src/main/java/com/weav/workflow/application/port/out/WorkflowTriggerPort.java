package com.weav.workflow.application.port.out;

import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Persistence boundary for version-pinned automatic trigger registrations. */
public interface WorkflowTriggerPort {

    /** Disables previous registrations and inserts the supplied registrations atomically. */
    void replaceCurrent(UUID workflowId, UUID versionId, List<WorkflowTrigger> triggers);

    WorkflowTrigger find(UUID triggerId);

    /** Looks up an ingress candidate by its opaque endpoint identifier. */
    Optional<WorkflowTrigger> findWebhookByEndpoint(String endpointKey);

    /** Looks up a Telegram ingress candidate by its opaque endpoint identifier (never returns webhook triggers). */
    Optional<WorkflowTrigger> findTelegramByEndpoint(String endpointKey);

    /**
     * Whether a workflow other than {@code excludingWorkflowId} has an active, undeleted Telegram trigger on this
     * connection (one bot can point at one webhook). Takes a transaction-scoped advisory lock on the connection
     * so two concurrent publishes cannot both pass the check; call it inside the publishing transaction.
     */
    boolean isTelegramConnectionInUse(UUID connectionId, UUID excludingWorkflowId);

    /** Whether any active, undeleted Telegram trigger uses this connection. Runs in its own transaction. */
    boolean hasActiveTelegramTrigger(UUID connectionId);

    /**
     * Compensation write that must survive a rolled-back caller, so it runs in its own transaction: optionally
     * replaces the secret verifier and sets (or, with null, clears) {@code lastError} of a Telegram trigger.
     */
    void updateTelegramRegistration(UUID triggerId, String newSecretHash, Map<String, Object> lastError);

    /** Turns a Telegram trigger off with the readiness reason {@code DEPENDENCY_NOT_CONFIGURED}. */
    void disableTelegramNotConfigured(UUID triggerId);

    /** Replaces the stored verifier of a provisioned webhook or Telegram trigger (secret rotation on resume). */
    void replaceSecretHash(UUID triggerId, String secretHash);

    List<WorkflowTrigger> findCurrent(UUID workflowId, UUID versionId);

    List<ScheduleCandidate> findDueSchedules(Instant now, int limit);

    Optional<WorkflowTrigger> lockCurrent(UUID workflowId, UUID triggerId);

    void initializeSchedule(UUID triggerId, Instant nextRunAt);

    void advanceSchedule(UUID triggerId, Instant scheduledAt, Instant nextRunAt);

    void recordScheduleFailure(UUID triggerId, Instant retryAt);

    /** Enables only ready registrations belonging to this immutable version. */
    void setCurrentEnabled(UUID workflowId, UUID versionId, boolean enabled, Instant enabledAt,
                           Map<UUID, Instant> nextRunAtByTrigger);

    record ScheduleCandidate(UUID workflowId, UUID triggerId) {
    }
}
