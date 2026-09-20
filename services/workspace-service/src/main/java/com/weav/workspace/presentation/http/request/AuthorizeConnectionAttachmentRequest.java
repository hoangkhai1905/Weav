package com.weav.workspace.presentation.http.request;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record AuthorizeConnectionAttachmentRequest(@NotNull UUID userId) {
}
