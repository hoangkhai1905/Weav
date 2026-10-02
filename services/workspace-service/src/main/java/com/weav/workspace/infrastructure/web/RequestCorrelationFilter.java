package com.weav.workspace.infrastructure.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Establishes the request correlation value before Spring Security can reject a request.
 * The value is deliberately opaque and bounded so it is safe to echo in a response header
 * and include in diagnostic logs.
 */
public final class RequestCorrelationFilter extends OncePerRequestFilter {

    public static final String HEADER_NAME = "X-Correlation-Id";
    public static final String REQUEST_ID_ATTRIBUTE = RequestCorrelationFilter.class.getName() + ".requestId";
    public static final String MDC_KEY = "requestId";

    private static final Pattern SAFE_REQUEST_ID = Pattern.compile("[A-Za-z0-9._:-]{1,128}");

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        String requestId = resolve(request);
        request.setAttribute(REQUEST_ID_ATTRIBUTE, requestId);
        response.setHeader(HEADER_NAME, requestId);
        MDC.put(MDC_KEY, requestId);
        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove(MDC_KEY);
        }
    }

    public static String requestId(HttpServletRequest request) {
        Object attribute = request.getAttribute(REQUEST_ID_ATTRIBUTE);
        if (attribute instanceof String value && isSafe(value)) {
            return value;
        }
        String current = currentRequestId();
        if (current != null) {
            request.setAttribute(REQUEST_ID_ATTRIBUTE, current);
            return current;
        }
        String incoming = request.getHeader(HEADER_NAME);
        String resolved = isSafe(incoming) ? incoming.trim() : UUID.randomUUID().toString();
        request.setAttribute(REQUEST_ID_ATTRIBUTE, resolved);
        return resolved;
    }

    public static String currentRequestId() {
        String current = MDC.get(MDC_KEY);
        return isSafe(current) ? current : null;
    }

    private static String resolve(HttpServletRequest request) {
        String incoming = request.getHeader(HEADER_NAME);
        return isSafe(incoming) ? incoming.trim() : UUID.randomUUID().toString();
    }

    private static boolean isSafe(String value) {
        return value != null && SAFE_REQUEST_ID.matcher(value.trim()).matches();
    }
}
