package com.weav.identity.presentation.http.request;

import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;
import java.util.UUID;

public record DirectoryBatchRequest(
        @NotEmpty
        @Size(max = 500)
        List<UUID> userIds) {
}
