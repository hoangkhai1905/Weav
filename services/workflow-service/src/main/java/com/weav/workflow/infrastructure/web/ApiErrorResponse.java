package com.weav.workflow.infrastructure.web;

import java.time.Instant;
import java.util.List;

public record ApiErrorResponse(
        ErrorBody error,
        Instant timestamp,
        int status,
        String path
) {

    public static ApiErrorResponse of(
            String code,
            String message,
            int status,
            String path,
            List<ErrorDetail> details
    ) {
        return new ApiErrorResponse(
                new ErrorBody(code, message, details == null ? List.of() : List.copyOf(details)),
                Instant.now(),
                status,
                path
        );
    }

    public record ErrorBody(
            String code,
            String message,
            List<ErrorDetail> details
    ) {
    }

    public record ErrorDetail(
            String field,
            String message
    ) {
    }
}
