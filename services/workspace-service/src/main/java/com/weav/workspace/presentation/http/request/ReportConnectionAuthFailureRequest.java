package com.weav.workspace.presentation.http.request;

import com.weav.workspace.application.dto.ConnectionAuthFailureCode;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record ReportConnectionAuthFailureRequest(@NotNull ConnectionAuthFailureCode failureCode, UUID credentialId) {
}
