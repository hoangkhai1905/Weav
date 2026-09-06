package com.weav.identity.infrastructure.security;

import com.weav.identity.infrastructure.web.ApiErrorResponse;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.List;

public final class AuthRateLimitFilter extends OncePerRequestFilter {

    private final AuthRateLimiter rateLimiter;
    private final ObjectMapper objectMapper;

    public AuthRateLimitFilter(AuthRateLimiter rateLimiter, ObjectMapper objectMapper) {
        this.rateLimiter = rateLimiter;
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        AuthRateLimiter.Scope scope = scopeFor(request);
        if (scope == null) {
            filterChain.doFilter(request, response);
            return;
        }

        try {
            rateLimiter.requireAllowed(scope, request.getRemoteAddr());
            filterChain.doFilter(request, response);
        } catch (AuthRateLimitExceededException exception) {
            response.setStatus(429);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setHeader(HttpHeaders.RETRY_AFTER, Long.toString(exception.retryAfterSeconds()));
            objectMapper.writeValue(
                    response.getOutputStream(),
                    ApiErrorResponse.of(
                            "RATE_LIMITED",
                            "Too many authentication attempts",
                            429,
                            request.getRequestURI(),
                            List.of()
                    )
            );
        }
    }

    private AuthRateLimiter.Scope scopeFor(HttpServletRequest request) {
        if (!"POST".equals(request.getMethod())) {
            return null;
        }
        return switch (request.getServletPath()) {
            case "/auth/register" -> AuthRateLimiter.Scope.REGISTER_IP;
            case "/auth/login" -> AuthRateLimiter.Scope.LOGIN_IP;
            case "/auth/refresh" -> AuthRateLimiter.Scope.REFRESH_IP;
            default -> null;
        };
    }
}
