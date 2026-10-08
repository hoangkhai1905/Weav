package com.weav.identity.infrastructure.security;

import com.weav.identity.infrastructure.web.ApiErrorResponse;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AuthRateLimitFilterTest {

    private static final GenericContainer<?> VALKEY =
            new GenericContainer<>(DockerImageName.parse("valkey/valkey:8-alpine")).withExposedPorts(6379);
    private static LettuceConnectionFactory connectionFactory;
    private static StringRedisTemplate redis;
    private static final String REMOTE_ADDRESS = "198.51.100.10";

    private ObjectMapper objectMapper;
    private AuthRateLimiter rateLimiter;
    private AuthRateLimitFilter filter;

    @BeforeEach
    void setUp() {
        if (redis == null) {
            VALKEY.start();
            connectionFactory = new LettuceConnectionFactory(VALKEY.getHost(), VALKEY.getMappedPort(6379));
            connectionFactory.afterPropertiesSet();
            redis = new StringRedisTemplate(connectionFactory);
            redis.afterPropertiesSet();
        }
        redis.getConnectionFactory().getConnection().serverCommands().flushDb();
        objectMapper = JsonMapper.builder().findAndAddModules().build();
        rateLimiter = new AuthRateLimiter(redis);
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
        assertRetryAfterNear(deniedResponse, 60);
        assertEquals("no-store", deniedResponse.getHeader(HttpHeaders.CACHE_CONTROL));
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
    void passesThroughNonTargetRoutes() throws Exception {
        AtomicInteger downstreamCalls = new AtomicInteger();
        FilterChain chain = countingChain(downstreamCalls);

        filter.doFilter(
                request("GET", "/auth/register", REMOTE_ADDRESS),
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

        assertEquals(3, downstreamCalls.get());
        assertEquals(0, redis.keys("identity:ratelimit:*").size());
    }

    @Test
    void rateLimitsOAuthUnlinkByRemoteAddress() throws Exception {
        AtomicInteger downstreamCalls = new AtomicInteger();
        FilterChain chain = countingChain(downstreamCalls);
        String accountPath = "/users/me/oauth-accounts/33333333-3333-3333-3333-333333333333";

        for (int attempt = 0; attempt < 10; attempt++) {
            filter.doFilter(
                    request("DELETE", accountPath, REMOTE_ADDRESS),
                    new MockHttpServletResponse(),
                    chain);
        }

        MockHttpServletResponse deniedResponse = new MockHttpServletResponse();
        filter.doFilter(request("DELETE", accountPath, REMOTE_ADDRESS), deniedResponse, chain);

        assertEquals(429, deniedResponse.getStatus());
        assertRetryAfterNear(deniedResponse, 900);
        assertEquals("no-store", deniedResponse.getHeader(HttpHeaders.CACHE_CONTROL));
        assertEquals("no-referrer", deniedResponse.getHeader("Referrer-Policy"));
        assertEquals(10, downstreamCalls.get());
    }

    @Test
    void rateLimitsCookieRefreshAndLogoutByRemoteAddress() throws Exception {
        AtomicInteger downstreamCalls = new AtomicInteger();
        FilterChain chain = countingChain(downstreamCalls);

        for (int attempt = 0; attempt < 30; attempt++) {
            filter.doFilter(
                    request("POST", "/auth/web/refresh", REMOTE_ADDRESS),
                    new MockHttpServletResponse(),
                    chain);
        }
        MockHttpServletResponse refreshDenied = new MockHttpServletResponse();
        filter.doFilter(
                request("POST", "/auth/web/refresh", REMOTE_ADDRESS),
                refreshDenied,
                chain);
        assertEquals(429, refreshDenied.getStatus());
        assertRetryAfterNear(refreshDenied, 60);
        assertEquals("no-referrer", refreshDenied.getHeader("Referrer-Policy"));

        for (int attempt = 0; attempt < 10; attempt++) {
            filter.doFilter(
                    request("POST", "/auth/web/logout", "203.0.113.10"),
                    new MockHttpServletResponse(),
                    chain);
        }
        MockHttpServletResponse logoutDenied = new MockHttpServletResponse();
        filter.doFilter(
                request("POST", "/auth/web/logout", "203.0.113.10"),
                logoutDenied,
                chain);
        assertEquals(429, logoutDenied.getStatus());
        assertRetryAfterNear(logoutDenied, 900);
        assertEquals("no-referrer", logoutDenied.getHeader("Referrer-Policy"));
        assertEquals(40, downstreamCalls.get());
    }

    @Test
    void rateLimitsResetPasswordAndLogoutByRemoteAddress() throws Exception {
        AtomicInteger downstreamCalls = new AtomicInteger();
        FilterChain chain = countingChain(downstreamCalls);

        assertDeniedAfter("/auth/reset-password", 10, "900", chain);
        assertDeniedAfter("/auth/logout", 30, "60", chain);
        assertEquals(40, downstreamCalls.get());
    }

    @Test
    void mobileExchangeUsesTheOAuthExchangeScopeSharedWithTheWebExchange() throws Exception {
        AtomicInteger downstreamCalls = new AtomicInteger();
        FilterChain chain = countingChain(downstreamCalls);

        // OAUTH_EXCHANGE_IP allows 30 per minute per address; 20 mobile + 10 web spend the same bucket.
        for (int attempt = 0; attempt < 20; attempt++) {
            filter.doFilter(request("POST", "/auth/oauth/mobile/exchange", REMOTE_ADDRESS),
                    new MockHttpServletResponse(), chain);
        }
        for (int attempt = 0; attempt < 10; attempt++) {
            filter.doFilter(request("POST", "/auth/oauth/exchange", REMOTE_ADDRESS),
                    new MockHttpServletResponse(), chain);
        }
        MockHttpServletResponse denied = new MockHttpServletResponse();
        filter.doFilter(request("POST", "/auth/oauth/mobile/exchange", REMOTE_ADDRESS), denied, chain);

        assertEquals(429, denied.getStatus());
        assertRetryAfterNear(denied, 60);
        assertEquals("no-referrer", denied.getHeader("Referrer-Policy"));
        assertEquals(30, downstreamCalls.get());
    }

    @Test
    void mobileStartIsRateLimitedAsAGetInTheOAuthStartScopeSharedWithTheWebStart() throws Exception {
        AtomicInteger downstreamCalls = new AtomicInteger();
        FilterChain chain = countingChain(downstreamCalls);

        // OAUTH_START_IP allows 10 per 15 minutes per address; 5 mobile + 5 web spend the same bucket.
        for (int attempt = 0; attempt < 5; attempt++) {
            filter.doFilter(request("GET", "/auth/oauth/google/mobile/start", REMOTE_ADDRESS),
                    new MockHttpServletResponse(), chain);
            filter.doFilter(request("POST", "/auth/oauth/google/start", REMOTE_ADDRESS),
                    new MockHttpServletResponse(), chain);
        }
        MockHttpServletResponse denied = new MockHttpServletResponse();
        filter.doFilter(request("GET", "/auth/oauth/google/mobile/start", REMOTE_ADDRESS), denied, chain);

        assertEquals(429, denied.getStatus());
        assertRetryAfterNear(denied, 900);
        assertEquals(10, downstreamCalls.get());

        // A different address has its own bucket.
        MockHttpServletResponse other = new MockHttpServletResponse();
        filter.doFilter(request("GET", "/auth/oauth/google/mobile/start", "203.0.113.77"), other, chain);
        assertEquals(200, other.getStatus());
    }

    private void assertDeniedAfter(String path, int limit, String retryAfter, FilterChain chain) throws Exception {
        for (int attempt = 0; attempt < limit; attempt++) {
            filter.doFilter(request("POST", path, REMOTE_ADDRESS), new MockHttpServletResponse(), chain);
        }
        MockHttpServletResponse denied = new MockHttpServletResponse();
        filter.doFilter(request("POST", path, REMOTE_ADDRESS), denied, chain);
        assertEquals(429, denied.getStatus());
        assertRetryAfterNear(denied, Long.parseLong(retryAfter));
    }

    /** Retry-After comes from the remaining Valkey TTL, so a slow run may see a few seconds less. */
    private static void assertRetryAfterNear(MockHttpServletResponse response, long windowSeconds) {
        long retry = Long.parseLong(response.getHeader(HttpHeaders.RETRY_AFTER));
        assertTrue(retry <= windowSeconds && retry >= windowSeconds - 5, "Retry-After was " + retry);
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

    @AfterAll
    static void stopValkey() {
        if (connectionFactory != null) connectionFactory.destroy();
        VALKEY.stop();
    }
}
