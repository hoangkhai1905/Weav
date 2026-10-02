package com.weav.workflow.presentation.http.request;

import jakarta.validation.constraints.NotNull;

import java.util.Map;

/** Public manual execution envelope; the trigger input is intentionally object-only. */
public record ManualExecutionRequest(@NotNull Map<String, Object> input) {
}
