package com.weav.identity.presentation.http.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record DirectoryEmailLookupRequest(
        @NotBlank
        @Size(max = 320)
        String email) {
}
