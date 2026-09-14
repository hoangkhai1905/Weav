package com.weav.workspace.presentation.http.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record AddMemberRequest(
        @NotBlank(message = "Email is required")
        @Size(max = 320, message = "Email must not exceed 320 characters")
        String email) {
}
