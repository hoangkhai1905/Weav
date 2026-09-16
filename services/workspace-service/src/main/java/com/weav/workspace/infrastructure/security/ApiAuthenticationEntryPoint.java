package com.weav.workspace.infrastructure.security;

import com.weav.workspace.infrastructure.web.ApiErrorResponse;
import com.weav.workspace.infrastructure.web.RequestCorrelationFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;

@Component
public final class ApiAuthenticationEntryPoint implements AuthenticationEntryPoint {

    private final ObjectMapper objectMapper;

    public ApiAuthenticationEntryPoint(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public void commence(
            HttpServletRequest request,
            HttpServletResponse response,
            AuthenticationException authenticationException) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        String requestId = RequestCorrelationFilter.requestId(request);
        response.setHeader(RequestCorrelationFilter.HEADER_NAME, requestId);
        objectMapper.writeValue(
                response.getOutputStream(),
                ApiErrorResponse.of(
                        "UNAUTHORIZED",
                        "Authentication failed",
                        requestId));
    }
}
