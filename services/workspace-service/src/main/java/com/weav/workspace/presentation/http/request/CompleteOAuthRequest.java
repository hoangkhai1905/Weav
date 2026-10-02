package com.weav.workspace.presentation.http.request;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record CompleteOAuthRequest(
        @NotNull @Pattern(regexp = "[A-Za-z0-9_-]{32,128}") String completion) {

    /** The completion id is a bearer-like secret and must not appear in logs. */
    @Override
    public String toString() {
        return "CompleteOAuthRequest[completion=<redacted>]";
    }
}
