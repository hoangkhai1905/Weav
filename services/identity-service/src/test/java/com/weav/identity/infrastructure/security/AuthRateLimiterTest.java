package com.weav.identity.infrastructure.security;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AuthRateLimiterTest {

    private static final GenericContainer<?> VALKEY =
            new GenericContainer<>(DockerImageName.parse("valkey/valkey:8-alpine")).withExposedPorts(6379);
    private static LettuceConnectionFactory connectionFactory;
    private static StringRedisTemplate redis;

    private AuthRateLimiter limiter;

    @BeforeAll
    static void connect() {
        VALKEY.start();
        connectionFactory = new LettuceConnectionFactory(VALKEY.getHost(), VALKEY.getMappedPort(6379));
        connectionFactory.afterPropertiesSet();
        redis = new StringRedisTemplate(connectionFactory);
        redis.afterPropertiesSet();
    }

    @AfterAll
    static void disconnect() {
        connectionFactory.destroy();
        VALKEY.stop();
    }

    @BeforeEach
    void reset() {
        redis.getConnectionFactory().getConnection().serverCommands().flushDb();
        limiter = new AuthRateLimiter(redis);
    }

    @Test
    void enforcesLimitAndReturnsWindowRetryDelay() {
        for (int attempt = 0; attempt < 5; attempt++) {
            assertTrue(limiter.attempt(AuthRateLimiter.Scope.REGISTER_IP, "127.0.0.1").allowed());
        }

        AuthRateLimiter.Decision denied = limiter.attempt(AuthRateLimiter.Scope.REGISTER_IP, "127.0.0.1");
        assertFalse(denied.allowed());
        assertTrue(denied.retryAfterSeconds() >= 59 && denied.retryAfterSeconds() <= 60);
    }

    @Test
    void startsANewWindowAfterExpiration() throws Exception {
        for (int attempt = 0; attempt < 5; attempt++) {
            limiter.attempt(AuthRateLimiter.Scope.REGISTER_IP, "127.0.0.1");
        }
        assertFalse(limiter.attempt(AuthRateLimiter.Scope.REGISTER_IP, "127.0.0.1").allowed());

        shortenAllWindows();
        Thread.sleep(150);

        assertTrue(limiter.attempt(AuthRateLimiter.Scope.REGISTER_IP, "127.0.0.1").allowed());
    }

    @Test
    void manyDistinctKeysNeverBlockANewKey() {
        for (int index = 0; index < 20_000; index++) {
            assertTrue(limiter.attempt(AuthRateLimiter.Scope.LOGIN_IP, "attacker-" + index).allowed());
        }
        assertTrue(limiter.attempt(AuthRateLimiter.Scope.LOGIN_IP, "legit-user").allowed());
    }

    @Test
    void storesOnlyHashedIdentifiers() {
        limiter.attempt(AuthRateLimiter.Scope.LOGIN_ACCOUNT, "victim@example.com");

        var keys = redis.keys("identity:ratelimit:*");
        assertEquals(1, keys.size());
        assertFalse(keys.iterator().next().contains("victim"));
    }

    @Test
    void successfulLoginsRefundTheirReservationAndNeverBlock() {
        for (int login = 0; login < 50; login++) {
            assertDoesNotThrow(() -> limiter.requireAllowed(AuthRateLimiter.Scope.LOGIN_ACCOUNT, "a@example.com"));
            limiter.refund(AuthRateLimiter.Scope.LOGIN_ACCOUNT, "a@example.com");
        }
    }

    @Test
    void refundNeverCreatesAKeyOrGoesNegative() {
        limiter.refund(AuthRateLimiter.Scope.LOGIN_ACCOUNT, "ghost@example.com");

        assertEquals(0, redis.keys("identity:ratelimit:*").size());
    }

    @Test
    void failedLoginsBlockAccountAtTheLimitAndWindowExpires() throws Exception {
        for (int failure = 0; failure < 10; failure++) {
            assertDoesNotThrow(() -> limiter.requireAllowed(AuthRateLimiter.Scope.LOGIN_ACCOUNT, "a@example.com"));
        }

        AuthRateLimitExceededException blocked = assertThrows(AuthRateLimitExceededException.class,
                () -> limiter.requireAllowed(AuthRateLimiter.Scope.LOGIN_ACCOUNT, "a@example.com"));
        assertTrue(blocked.retryAfterSeconds() > 0);
        assertDoesNotThrow(() -> limiter.requireAllowed(AuthRateLimiter.Scope.LOGIN_ACCOUNT, "other@example.com"));

        shortenAllWindows();
        Thread.sleep(150);

        assertDoesNotThrow(() -> limiter.requireAllowed(AuthRateLimiter.Scope.LOGIN_ACCOUNT, "a@example.com"));
    }

    @Test
    void counterIsSharedAcrossLimiterInstances() {
        AuthRateLimiter replicaTwo = new AuthRateLimiter(redis);
        for (int attempt = 0; attempt < 3; attempt++) {
            assertTrue(limiter.attempt(AuthRateLimiter.Scope.REGISTER_IP, "shared").allowed());
        }
        assertTrue(replicaTwo.attempt(AuthRateLimiter.Scope.REGISTER_IP, "shared").allowed());
        assertTrue(replicaTwo.attempt(AuthRateLimiter.Scope.REGISTER_IP, "shared").allowed());
        assertFalse(limiter.attempt(AuthRateLimiter.Scope.REGISTER_IP, "shared").allowed());
    }

    @Test
    void incrementsAtomicallyUnderConcurrency() throws Exception {
        int callers = 40;
        CountDownLatch ready = new CountDownLatch(callers);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(callers);
        try {
            List<Future<Boolean>> futures = new ArrayList<>();
            for (int index = 0; index < callers; index++) {
                futures.add(executor.submit(() -> {
                    ready.countDown();
                    start.await();
                    return limiter.attempt(AuthRateLimiter.Scope.LOGIN_IP, "shared").allowed();
                }));
            }
            ready.await();
            start.countDown();

            long allowed = 0;
            for (Future<Boolean> future : futures) {
                if (future.get()) {
                    allowed++;
                }
            }
            assertEquals(20, allowed);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void failsOpenWhenValkeyIsUnavailable() {
        StringRedisTemplate broken = mock(StringRedisTemplate.class);
        when(broken.execute(any(RedisScript.class), anyList(), any(Object[].class)))
                .thenThrow(new QueryTimeoutException("valkey down"));
        when(broken.execute(any(RedisScript.class), anyList()))
                .thenThrow(new QueryTimeoutException("valkey down"));
        AuthRateLimiter degraded = new AuthRateLimiter(broken);

        assertDoesNotThrow(() -> degraded.requireAllowed(AuthRateLimiter.Scope.LOGIN_IP, "1.2.3.4"));
        assertDoesNotThrow(() -> degraded.refund(AuthRateLimiter.Scope.LOGIN_ACCOUNT, "a@example.com"));
    }

    private static void shortenAllWindows() {
        for (String key : redis.keys("identity:ratelimit:*")) {
            redis.expire(key, Duration.ofMillis(50));
        }
    }
}
