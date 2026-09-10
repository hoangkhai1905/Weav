package com.weav.identity.infrastructure.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/** Keeps OAuth error and redirect responses non-cacheable and non-referring, including CORS rejections. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public final class OAuthTransportHeadersFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        if (isOAuthTransportPath(request.getRequestURI())) {
            response.setHeader("Cache-Control", "no-store");
            response.setHeader("Referrer-Policy", "no-referrer");
        }
        filterChain.doFilter(request, response);
    }

    private static boolean isOAuthTransportPath(String path) {
        return path != null && (path.startsWith("/auth/oauth/")
                || path.startsWith("/auth/web/")
                || path.startsWith("/users/me/oauth"));
    }
}
