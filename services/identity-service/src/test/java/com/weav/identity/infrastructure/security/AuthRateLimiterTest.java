package com.weav.identity.infrastructure.security;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AuthRateLimiterTest {

    @Test
    void enforcesLimitAndReturnsWindowRetryDelay() {
        MutableClock clock = new MutableClock(Instant.parse("2026-09-05T10:00:00Z"));
        AuthRateLimiter limiter = new AuthRateLimiter(clock, 100);

        for (int attempt = 0; attempt < 5; attempt++) {
            assertTrue(limiter.attempt(AuthRateLimiter.Scope.REGISTER_IP, "127.0.0.1").allowed());
        }

        AuthRateLimiter.Decision denied = limiter.attempt(AuthRateLimiter.Scope.REGISTER_IP, "127.0.0.1");
        assertFalse(denied.allowed());
        assertEquals(60, denied.retryAfterSeconds());
    }

    @Test
    void startsANewWindowAtExactExpiration() {
        MutableClock clock = new MutableClock(Instant.parse("2026-09-05T10:00:00Z"));
        AuthRateLimiter limiter = new AuthRateLimiter(clock, 100);
        for (int attempt = 0; attempt < 5; attempt++) {
            limiter.attempt(AuthRateLimiter.Scope.REGISTER_IP, "127.0.0.1");
        }

        clock.advanceSeconds(60);

        assertTrue(limiter.attempt(AuthRateLimiter.Scope.REGISTER_IP, "127.0.0.1").allowed());
        assertEquals(1, limiter.entryCount());
    }

    @Test
    void rejectsNewKeysWhenCapacityIsFullButKeepsExistingKeysUsable() {
        MutableClock clock = new MutableClock(Instant.parse("2026-09-05T10:00:00Z"));
        AuthRateLimiter limiter = new AuthRateLimiter(clock, 2);
        assertTrue(limiter.attempt(AuthRateLimiter.Scope.LOGIN_IP, "one").allowed());
        assertTrue(limiter.attempt(AuthRateLimiter.Scope.LOGIN_IP, "two").allowed());

        assertFalse(limiter.attempt(AuthRateLimiter.Scope.LOGIN_IP, "three").allowed());
        assertTrue(limiter.attempt(AuthRateLimiter.Scope.LOGIN_IP, "one").allowed());
        assertEquals(2, limiter.entryCount());
    }

    @Test
    void incrementsAtomicallyUnderConcurrency() throws Exception {
        AuthRateLimiter limiter = new AuthRateLimiter(
                Clock.fixed(Instant.parse("2026-09-05T10:00:00Z"), ZoneOffset.UTC),
                100
        );
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

    private static final class MutableClock extends Clock {

        private Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        void advanceSeconds(long seconds) {
            instant = instant.plusSeconds(seconds);
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
