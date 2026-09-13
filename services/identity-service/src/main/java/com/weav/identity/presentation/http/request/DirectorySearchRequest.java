package com.weav.identity.presentation.http.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.UUID;

public record DirectorySearchRequest(
        @NotEmpty
        @Size(max = 500)
        List<UUID> candidateUserIds,
        @Size(max = 120)
        String search,
        @Min(0)
        int page,
        @Min(1)
        @Max(100)
        int size,
        @NotNull
        @NotBlank
        String direction,
        @jakarta.validation.constraints.Pattern(regexp = "displayName")
        String sort) {
}
