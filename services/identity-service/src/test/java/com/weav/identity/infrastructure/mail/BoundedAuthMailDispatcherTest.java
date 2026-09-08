package com.weav.identity.infrastructure.mail;

import com.weav.identity.application.port.out.AuthMailDispatcher;
import com.weav.identity.application.port.out.AuthMailSender;
import com.weav.identity.domain.exception.DependencyUnavailableException;
import com.weav.identity.infrastructure.config.MailProperties;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BoundedAuthMailDispatcherTest {

    @Test
    void admissionIsBoundedAndSenderNeverRunsOnCallerThread() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicReference<String> senderThread = new AtomicReference<>();
        AuthMailSender sender = message -> {
            senderThread.set(Thread.currentThread().getName());
            started.countDown();
            try {
                release.await(2, TimeUnit.SECONDS);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
            }
        };

        MailProperties properties = properties(1, 1, 1);
        try (BoundedAuthMailDispatcher dispatcher = new BoundedAuthMailDispatcher(sender, properties)) {
            dispatcher.reserve().dispatch(message(), null);
            assertTrue(started.await(1, TimeUnit.SECONDS));
            dispatcher.reserve().dispatch(message(), null);

            assertThrows(DependencyUnavailableException.class, dispatcher::reserve);
            assertNotEquals(Thread.currentThread().getName(), senderThread.get());
            release.countDown();
        }
    }

    @Test
    void failedDeliveryInvokesCleanupAndReleasesCapacity() throws Exception {
        CountDownLatch cleanup = new CountDownLatch(1);
        AuthMailSender sender = message -> {
            throw new IllegalStateException("provider detail must not escape");
        };

        try (BoundedAuthMailDispatcher dispatcher = new BoundedAuthMailDispatcher(sender, properties(1, 1, 1))) {
            dispatcher.reserve().dispatch(message(), cleanup::countDown);
            assertTrue(cleanup.await(1, TimeUnit.SECONDS));
            assertDoesNotThrow(() -> dispatcher.reserve().close());
        }
    }

    @Test
    void reservationAdmissionDoesNotWaitForAFreeSlot() {
        AuthMailSender sender = message -> {
        };
        try (BoundedAuthMailDispatcher dispatcher = new BoundedAuthMailDispatcher(sender, properties(1, 1, 1))) {
            assertDoesNotThrow(() -> dispatcher.reserve().close());
            AuthMailDispatcher.Lease lease = org.junit.jupiter.api.Assertions.assertTimeout(
                    Duration.ofMillis(100), dispatcher::reserve);
            lease.close();
        }
    }

    private static AuthMailSender.Message message() {
        return new AuthMailSender.Message("person@example.com", "Authentication code", "code");
    }

    private static MailProperties properties(int queue, int core, int max) {
        MailProperties properties = new MailProperties();
        properties.setQueueCapacity(queue);
        properties.setCorePoolSize(core);
        properties.setMaxPoolSize(max);
        return properties;
    }
}
