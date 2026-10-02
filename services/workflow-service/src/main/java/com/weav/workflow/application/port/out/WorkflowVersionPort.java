package com.weav.workflow.application.port.out;

import com.weav.workflow.domain.model.aggregate.workflow.WorkflowVersion;
import java.util.UUID;

/** Persistence boundary for immutable published workflow snapshots. */
public interface WorkflowVersionPort {

    /** Returns the next number while the owning workflow row is locked. */
    int nextNumber(UUID workflowId);

    /** Inserts one immutable version snapshot. */
    void insert(WorkflowVersion version);

    /** Loads a version by its explicit identity or throws a not-found error. */
    WorkflowVersion require(UUID versionId);
}
