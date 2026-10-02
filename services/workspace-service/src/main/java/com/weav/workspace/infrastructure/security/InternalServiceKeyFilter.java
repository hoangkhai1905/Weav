package com.weav.workspace.infrastructure.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.authentication.preauth.PreAuthenticatedAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

/** Authenticates {@code /internal/workspaces/**}: a scoped Workflow service JWT, or (transition) the static key. */
public final class InternalServiceKeyFilter extends OncePerRequestFilter {

    static final String HEADER_NAME = "X-Internal-Service-Key";
    private static final String INTERNAL_PREFIX = "/internal/workspaces/";

    private final InternalServiceKeyProperties properties;
    private final AuthenticationEntryPoint authenticationEntryPoint;
    private final InternalServiceJwtVerifier jwtVerifier;

    public InternalServiceKeyFilter(
            InternalServiceKeyProperties properties,
            AuthenticationEntryPoint authenticationEntryPoint,
            InternalServiceJwtVerifier jwtVerifier) {
        this.properties = properties;
        this.authenticationEntryPoint = authenticationEntryPoint;
        this.jwtVerifier = jwtVerifier;
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
        if (!isAuthenticated(request)) {
            authenticationEntryPoint.commence(
                    request,
                    response,
                    new BadCredentialsException("Internal service authentication failed"));
            return;
        }
        SecurityContextHolder.getContext().setAuthentication(new PreAuthenticatedAuthenticationToken(
                "weav-internal-service", null, AuthorityUtils.createAuthorityList("ROLE_INTERNAL_SERVICE")));
        filterChain.doFilter(request, response);
    }

    static boolean isInternalRequest(HttpServletRequest request) {
        return request.getServletPath().startsWith(INTERNAL_PREFIX);
    }

    /** A Bearer service JWT wins; the static key is only a transition fallback. */
    private boolean isAuthenticated(HttpServletRequest request) {
        String authorization = request.getHeader("Authorization");
        if (authorization != null && authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
            InternalServiceJwtVerifier.Required required = required(request.getServletPath());
            InternalServiceJwtVerifier.Result result = required == null
                    ? InternalServiceJwtVerifier.Result.INVALID
                    : jwtVerifier.verify(authorization.substring(7).trim(), required);
            if (result == InternalServiceJwtVerifier.Result.OK) {
                return true;
            }
            if (result == InternalServiceJwtVerifier.Result.INVALID) {
                return false;
            }
            // UNAVAILABLE (no readable JWKS): fall through to the static key unless it is switched off.
        }
        return !properties.requireServiceJwt() && isValid(request.getHeader(HEADER_NAME));
    }

    /** Scope and path ids for the connection endpoints and the access endpoint; anything else has none. */
    static InternalServiceJwtVerifier.Required required(String servletPath) {
        String[] segments = servletPath.split("/");
        // ["", "internal", "workspaces", workspaceId, "connections"|"users", id, operation]
        if (segments.length != 7) {
            return null;
        }
        try {
            UUID workspaceId = UUID.fromString(segments[3]);
            UUID id = UUID.fromString(segments[5]);
            if ("users".equals(segments[4]) && "access".equals(segments[6])) {
                return new InternalServiceJwtVerifier.Required("workspace:access", workspaceId, null);
            }
            String scope = !"connections".equals(segments[4]) ? null : switch (segments[6]) {
                case "resolve" -> "connection:resolve";
                case "auth-failure" -> "connection:report-auth-failure";
                case "authorize-attachment" -> "connection:authorize-attachment";
                default -> null;
            };
            return scope == null ? null : new InternalServiceJwtVerifier.Required(scope, workspaceId, id);
        } catch (IllegalArgumentException exception) {
            return null;
        }
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
