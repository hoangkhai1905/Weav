package com.weav.workflow.domain.mapping;

import java.time.Instant;
import java.util.UUID;

/** Facts about the current run exposed to mappings as {@code now}, {@code run.id}, {@code workflow.*}. */
public record RunInfo(UUID runId, UUID workflowId, String workflowName, Instant now) {
}
