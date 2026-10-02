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
