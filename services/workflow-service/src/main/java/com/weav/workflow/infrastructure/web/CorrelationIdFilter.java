package com.weav.workflow.infrastructure.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

/** Establishes a bounded correlation ID before security can reject the request. */
public final class CorrelationIdFilter extends OncePerRequestFilter {

    public static final String HEADER_NAME = "X-Correlation-Id";
    public static final String REQUEST_ID_ATTRIBUTE = CorrelationIdFilter.class.getName() + ".requestId";
    public static final String MDC_KEY = "requestId";

    private static final Pattern SAFE_CORRELATION_ID = Pattern.compile("[A-Za-z0-9._:-]{1,128}");

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        String correlationId = resolve(request);
        request.setAttribute(REQUEST_ID_ATTRIBUTE, correlationId);
        response.setHeader(HEADER_NAME, correlationId);
        MDC.put(MDC_KEY, correlationId);
        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove(MDC_KEY);
        }
    }

    public static String requestId(HttpServletRequest request) {
        Object attribute = request.getAttribute(REQUEST_ID_ATTRIBUTE);
        if (attribute instanceof String value && isSafe(value)) {
            return value.trim();
        }
        String current = currentCorrelationId();
        if (current != null) {
            request.setAttribute(REQUEST_ID_ATTRIBUTE, current);
            return current;
        }
        String incoming = request.getHeader(HEADER_NAME);
        String resolved = isSafe(incoming) ? incoming.trim() : UUID.randomUUID().toString();
        request.setAttribute(REQUEST_ID_ATTRIBUTE, resolved);
        return resolved;
    }

    public static String currentCorrelationId() {
        String current = MDC.get(MDC_KEY);
        return isSafe(current) ? current.trim() : null;
    }

    private static String resolve(HttpServletRequest request) {
        String incoming = request.getHeader(HEADER_NAME);
        return isSafe(incoming) ? incoming.trim() : UUID.randomUUID().toString();
    }

    private static boolean isSafe(String value) {
        return value != null && SAFE_CORRELATION_ID.matcher(value.trim()).matches();
    }
}
