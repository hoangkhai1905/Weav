package com.weav.identity.infrastructure.security;

import com.weav.identity.infrastructure.web.ApiErrorResponse;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AuthRateLimitFilterTest {

    private static final Instant NOW = Instant.parse("2026-09-05T10:00:00Z");
    private static final String REMOTE_ADDRESS = "198.51.100.10";

    private ObjectMapper objectMapper;
    private AuthRateLimiter rateLimiter;
    private AuthRateLimitFilter filter;

    @BeforeEach
    void setUp() {
        objectMapper = JsonMapper.builder().findAndAddModules().build();
        rateLimiter = new AuthRateLimiter(Clock.fixed(NOW, ZoneOffset.UTC), 100);
        filter = new AuthRateLimitFilter(rateLimiter, objectMapper);
    }

    @Test
    void returnsRateLimitedEnvelopeAndSkipsDownstreamChainForExactPostAuthRoute() throws Exception {
        AtomicInteger downstreamCalls = new AtomicInteger();
        FilterChain chain = countingChain(downstreamCalls);

        for (int attempt = 0; attempt < 5; attempt++) {
            filter.doFilter(
                    request("POST", "/auth/register", REMOTE_ADDRESS),
                    new MockHttpServletResponse(),
                    chain
            );
        }

        MockHttpServletResponse deniedResponse = new MockHttpServletResponse();
        filter.doFilter(
                request("POST", "/auth/register", REMOTE_ADDRESS),
                deniedResponse,
                chain
        );

        assertEquals(429, deniedResponse.getStatus());
        assertEquals(MediaType.APPLICATION_JSON_VALUE, deniedResponse.getContentType());
        assertEquals("60", deniedResponse.getHeader(HttpHeaders.RETRY_AFTER));
        assertEquals(5, downstreamCalls.get());

        ApiErrorResponse errorResponse = objectMapper.readValue(
                deniedResponse.getContentAsByteArray(),
                ApiErrorResponse.class
        );
        assertEquals("RATE_LIMITED", errorResponse.error().code());
        assertEquals("Too many authentication attempts", errorResponse.error().message());
        assertTrue(errorResponse.error().details().isEmpty());
        assertEquals(429, errorResponse.status());
        assertEquals("/auth/register", errorResponse.path());
    }

    @Test
    void usesRemoteAddressAndIgnoresForwardedHeadersForRateLimitKey() throws Exception {
        AtomicInteger downstreamCalls = new AtomicInteger();
        FilterChain chain = countingChain(downstreamCalls);

        for (int attempt = 0; attempt < 5; attempt++) {
            MockHttpServletRequest request = request("POST", "/auth/register", REMOTE_ADDRESS);
            request.addHeader("X-Forwarded-For", "203.0.113." + attempt);
            request.addHeader("Forwarded", "for=203.0.113." + attempt);
            filter.doFilter(request, new MockHttpServletResponse(), chain);
        }

        MockHttpServletRequest deniedRequest = request("POST", "/auth/register", REMOTE_ADDRESS);
        deniedRequest.addHeader("X-Forwarded-For", "192.0.2.200");
        deniedRequest.addHeader("Forwarded", "for=192.0.2.200");
        MockHttpServletResponse deniedResponse = new MockHttpServletResponse();
        filter.doFilter(deniedRequest, deniedResponse, chain);

        assertEquals(429, deniedResponse.getStatus());
        assertEquals(5, downstreamCalls.get());
    }

    @Test
    void passesThroughNonTargetAndLogoutRoutes() throws Exception {
        AtomicInteger downstreamCalls = new AtomicInteger();
        FilterChain chain = countingChain(downstreamCalls);

        filter.doFilter(
                request("GET", "/auth/register", REMOTE_ADDRESS),
                new MockHttpServletResponse(),
                chain
        );
        filter.doFilter(
                request("POST", "/auth/logout", REMOTE_ADDRESS),
                new MockHttpServletResponse(),
                chain
        );
        filter.doFilter(
                request("POST", "/auth/register/", REMOTE_ADDRESS),
                new MockHttpServletResponse(),
                chain
        );
        filter.doFilter(
                request("POST", "/users/me", REMOTE_ADDRESS),
                new MockHttpServletResponse(),
                chain
        );

        assertEquals(4, downstreamCalls.get());
        assertEquals(0, rateLimiter.entryCount());
    }

    private static MockHttpServletRequest request(String method, String servletPath, String remoteAddress) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, servletPath);
        request.setServletPath(servletPath);
        request.setRemoteAddr(remoteAddress);
        return request;
    }

    private static FilterChain countingChain(AtomicInteger downstreamCalls) {
        return (request, response) -> downstreamCalls.incrementAndGet();
    }
}
