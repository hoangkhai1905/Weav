package com.weav.workflow.application.service;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConnectionUsageRateLimiterTest {

    @Test
    void allowsOnlyConfiguredRequestsAndOpensANewWindowAtTheBoundary() {
        AtomicLong clock = new AtomicLong(0L);
        ConnectionUsageRateLimiter limiter = new ConnectionUsageRateLimiter(2, Duration.ofSeconds(1), clock::get);

        assertTrue(limiter.tryAcquire());
        assertTrue(limiter.tryAcquire());
        assertFalse(limiter.tryAcquire());

        clock.set(Duration.ofSeconds(1).toNanos());
        assertTrue(limiter.tryAcquire());
    }

    @Test
    void concurrentCallersCannotExceedTheFixedWindowLimit() throws Exception {
        int limit = 24;
        int workers = 12;
        int calls = 120;
        ConnectionUsageRateLimiter limiter = new ConnectionUsageRateLimiter(
                limit, Duration.ofHours(1), () -> 0L);
        CountDownLatch ready = new CountDownLatch(workers);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger accepted = new AtomicInteger();
        ExecutorService executor = Executors.newFixedThreadPool(workers);
        try {
            Future<?>[] requests = new Future<?>[workers];
            for (int index = 0; index < workers; index++) {
                requests[index] = executor.submit(() -> {
                    ready.countDown();
                    if (!start.await(10, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("Rate-limit test start was not released");
                    }
                    for (int call = 0; call < calls / workers; call++) {
                        if (limiter.tryAcquire()) {
                            accepted.incrementAndGet();
                        }
                    }
                    return null;
                });
            }
            assertTrue(ready.await(10, TimeUnit.SECONDS));
            start.countDown();
            for (Future<?> request : requests) {
                request.get(10, TimeUnit.SECONDS);
            }
        } finally {
            executor.shutdownNow();
            assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS));
        }

        assertEquals(limit, accepted.get());
    }

    @Test
    void rejectsNonPositiveLimitsAndWindows() {
        assertThrows(IllegalArgumentException.class,
                () -> new ConnectionUsageRateLimiter(0, Duration.ofSeconds(1), () -> 0L));
        assertThrows(IllegalArgumentException.class,
                () -> new ConnectionUsageRateLimiter(1, Duration.ZERO, () -> 0L));
    }
}
