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
            response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
            if (isOAuthTransportPath(request.getRequestURI())) {
                response.setHeader("Referrer-Policy", "no-referrer");
            }
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
        return switch (request.getMethod()) {
            case "POST" -> switch (request.getServletPath()) {
                case "/auth/register" -> AuthRateLimiter.Scope.REGISTER_IP;
                case "/auth/login" -> AuthRateLimiter.Scope.LOGIN_IP;
                case "/auth/refresh" -> AuthRateLimiter.Scope.REFRESH_IP;
                case "/auth/oauth/google/start" -> AuthRateLimiter.Scope.OAUTH_START_IP;
                case "/auth/oauth/exchange" -> AuthRateLimiter.Scope.OAUTH_EXCHANGE_IP;
                case "/auth/web/refresh" -> AuthRateLimiter.Scope.OAUTH_WEB_REFRESH_IP;
                case "/auth/web/logout" -> AuthRateLimiter.Scope.OAUTH_WEB_LOGOUT_IP;
                case "/users/me/oauth/google/link" -> AuthRateLimiter.Scope.OAUTH_LINK_START_IP;
                default -> null;
            };
            case "DELETE" -> request.getServletPath().startsWith("/users/me/oauth-accounts/")
                    ? AuthRateLimiter.Scope.OAUTH_UNLINK_IP
                    : null;
            case "GET" -> switch (request.getServletPath()) {
                case "/auth/oauth/google/callback" -> AuthRateLimiter.Scope.OAUTH_CALLBACK_IP;
                case "/auth/web/csrf" -> AuthRateLimiter.Scope.OAUTH_CSRF_IP;
                default -> null;
            };
            default -> null;
        };
    }

    private static boolean isOAuthTransportPath(String path) {
        return path != null && (path.startsWith("/auth/oauth/")
                || path.startsWith("/auth/web/")
                || path.startsWith("/users/me/oauth"));
    }
}
