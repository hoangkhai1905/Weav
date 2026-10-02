package com.weav.workspace.infrastructure.web;

/** Stable public and internal error contract from the Workspace OpenAPI schema. */
public record ApiErrorResponse(
        String code,
        String message,
        String requestId
) {

    public static ApiErrorResponse of(String code, String message, String requestId) {
        return new ApiErrorResponse(code, message, requestId);
    }
}
