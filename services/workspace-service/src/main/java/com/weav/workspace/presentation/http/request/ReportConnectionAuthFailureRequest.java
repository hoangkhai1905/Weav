package com.weav.workspace.presentation.http.request;

import com.weav.workspace.application.dto.ConnectionAuthFailureCode;
import jakarta.validation.constraints.NotNull;

public record ReportConnectionAuthFailureRequest(@NotNull ConnectionAuthFailureCode failureCode) {
}
