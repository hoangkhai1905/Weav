package com.weav.workflow.infrastructure.security;

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
import java.util.regex.Pattern;

/** Requires the independent Workspace service key on the one internal usage route. */
public final class InternalServiceKeyFilter extends OncePerRequestFilter {

    public static final String HEADER_NAME = "X-Internal-Service-Key";

    private static final String USAGE_METHOD = "GET";
    private static final Pattern USAGE_PATH = Pattern.compile(
            "/internal/workspaces/[^/]+/connections/[^/]+/usage");

    private final byte[] expectedServiceKey;
    private final AuthenticationEntryPoint authenticationEntryPoint;

    public InternalServiceKeyFilter(String configuredServiceKey, AuthenticationEntryPoint authenticationEntryPoint) {
        this.expectedServiceKey = configuredServiceKey == null || configuredServiceKey.isBlank()
                ? new byte[0]
                : configuredServiceKey.getBytes(StandardCharsets.UTF_8);
        this.authenticationEntryPoint = authenticationEntryPoint;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        if (!isInternalUsageRequest(request)) {
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

    private boolean isInternalUsageRequest(HttpServletRequest request) {
        String servletPath = request.getServletPath();
        return USAGE_METHOD.equals(request.getMethod())
                && servletPath != null
                && USAGE_PATH.matcher(servletPath).matches();
    }

    private boolean isValid(String presentedServiceKey) {
        if (expectedServiceKey.length == 0 || presentedServiceKey == null || presentedServiceKey.isBlank()) {
            return false;
        }
        return MessageDigest.isEqual(
                expectedServiceKey,
                presentedServiceKey.getBytes(StandardCharsets.UTF_8));
    }
}
