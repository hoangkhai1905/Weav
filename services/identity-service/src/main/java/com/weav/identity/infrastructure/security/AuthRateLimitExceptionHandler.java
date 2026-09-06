package com.weav.identity.infrastructure.security;

import com.weav.identity.infrastructure.web.ApiErrorResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.List;

@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice
public final class AuthRateLimitExceptionHandler {

    @ExceptionHandler(AuthRateLimitExceededException.class)
    public ResponseEntity<ApiErrorResponse> handle(
            AuthRateLimitExceededException exception,
            HttpServletRequest request
    ) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header(HttpHeaders.RETRY_AFTER, Long.toString(exception.retryAfterSeconds()))
                .body(ApiErrorResponse.of(
                        "RATE_LIMITED",
                        "Too many authentication attempts",
                        HttpStatus.TOO_MANY_REQUESTS.value(),
                        request.getRequestURI(),
                        List.of()
                ));
    }
}
