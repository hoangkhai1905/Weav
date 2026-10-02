package com.weav.workflow.infrastructure.web;

import jakarta.servlet.http.HttpServletRequest;

/** Redacts opaque webhook endpoint credentials from externally visible error paths. */
public final class WebhookRequestPath {
    private WebhookRequestPath() {
    }

    public static boolean isWebhookPath(HttpServletRequest request) {
        return path(request).startsWith("/webhooks/");
    }

    public static boolean isWebhookIngress(HttpServletRequest request) {
        return "POST".equalsIgnoreCase(request.getMethod())
                && path(request).matches("/webhooks/[^/]+/?");
    }

    public static String sanitizedPath(HttpServletRequest request) {
        String path = path(request);
        return path.startsWith("/webhooks/") ? "/webhooks/{endpointKey}" : request.getRequestURI();
    }

    private static String path(HttpServletRequest request) {
        String servletPath = request.getServletPath();
        if (servletPath != null && !servletPath.isEmpty()) {
            return servletPath;
        }
        String requestUri = request.getRequestURI();
        String contextPath = request.getContextPath();
        if (requestUri != null && contextPath != null && !contextPath.isEmpty()
                && requestUri.startsWith(contextPath)) {
            return requestUri.substring(contextPath.length());
        }
        return requestUri == null ? "" : requestUri;
    }
}
