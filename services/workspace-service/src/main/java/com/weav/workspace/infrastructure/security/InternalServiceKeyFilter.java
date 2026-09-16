package com.weav.workspace.infrastructure.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

public final class InternalServiceKeyFilter extends OncePerRequestFilter {

    static final String HEADER_NAME = "X-Internal-Service-Key";
    private static final String INTERNAL_PREFIX = "/internal/workspaces/";

    private final InternalServiceKeyProperties properties;
    private final AuthenticationEntryPoint authenticationEntryPoint;

    public InternalServiceKeyFilter(
            InternalServiceKeyProperties properties,
            AuthenticationEntryPoint authenticationEntryPoint) {
        this.properties = properties;
        this.authenticationEntryPoint = authenticationEntryPoint;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        if (!isInternalRequest(request)) {
            filterChain.doFilter(request, response);
            return;
        }
        if (!isValid(request.getHeader(HEADER_NAME))) {
            authenticationEntryPoint.commence(
                    request,
                    response,
                    new BadCredentialsException("Internal service authentication failed"));
            return;
        }
        filterChain.doFilter(request, response);
    }

    private boolean isInternalRequest(HttpServletRequest request) {
        return request.getServletPath().startsWith(INTERNAL_PREFIX);
    }

    private boolean isValid(String presented) {
        if (!properties.isConfigured() || presented == null || presented.isBlank()) {
            return false;
        }
        return MessageDigest.isEqual(
                properties.serviceKey().getBytes(StandardCharsets.UTF_8),
                presented.getBytes(StandardCharsets.UTF_8));
    }
}
