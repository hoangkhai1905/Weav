package com.weav.identity.infrastructure.storage;

import com.weav.identity.application.port.out.AvatarStorage;
import com.weav.identity.application.port.out.AvatarCleanupQueue;
import com.weav.identity.infrastructure.config.AvatarStorageProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Component
public final class AvatarCleanupReconciler implements AvatarCleanupQueue {

    private static final Logger log = LoggerFactory.getLogger(AvatarCleanupReconciler.class);
    private static final Duration MAX_RETRY_DELAY = Duration.ofMinutes(10);

    private final AvatarStorage storage;
    private final AvatarStorageProperties properties;
    private final Clock clock;
    private final Map<CleanupTask, RetryState> pending = new ConcurrentHashMap<>();

    public AvatarCleanupReconciler(AvatarStorage storage, AvatarStorageProperties properties, Clock clock) {
        this.storage = storage;
        this.properties = properties;
        this.clock = clock;
    }

    @Override
    public void enqueue(UUID userId, String objectKey) {
        if (userId == null || objectKey == null || objectKey.isBlank()) {
            return;
        }
        CleanupTask task = new CleanupTask(userId, objectKey);
        synchronized (pending) {
            if (!pending.containsKey(task) && pending.size() >= properties.getCleanupQueueCapacity()) {
                log.error("identity_avatar_cleanup_event userId={} objectKeyHash={} action=ENQUEUE result=QUEUE_FULL",
                        userId, Integer.toHexString(objectKey.hashCode()));
                return;
            }
            pending.putIfAbsent(task, new RetryState(clock.instant(), 0));
        }
        log.warn("identity_avatar_cleanup_event userId={} objectKeyHash={} action=ENQUEUE result=RETRYABLE",
                userId, Integer.toHexString(objectKey.hashCode()));
    }

    public int pendingCount() {
        return pending.size();
    }

    @Scheduled(fixedDelayString = "${weav.avatar.storage.cleanup-interval-ms:30000}")
    public void reconcileNow() {
        Instant now = clock.instant();
        pending.forEach((task, state) -> {
            if (state.nextAttempt().isAfter(now)) {
                return;
            }
            try {
                storage.delete(task.userId(), task.objectKey());
                pending.remove(task, state);
                log.info("identity_avatar_cleanup_event userId={} objectKeyHash={} action=DELETE result=SUCCESS",
                        task.userId(), Integer.toHexString(task.objectKey().hashCode()));
            } catch (RuntimeException exception) {
                int failures = state.failures() + 1;
                Duration delay = Duration.ofSeconds(Math.min(
                        MAX_RETRY_DELAY.toSeconds(),
                        5L * (1L << Math.min(failures, 7))));
                pending.replace(task, state, new RetryState(now.plus(delay), failures));
                log.warn("identity_avatar_cleanup_event userId={} objectKeyHash={} action=DELETE result=RETRYABLE failures={}",
                        task.userId(), Integer.toHexString(task.objectKey().hashCode()), failures);
            }
        });
    }

    private record CleanupTask(UUID userId, String objectKey) {
    }

    private record RetryState(Instant nextAttempt, int failures) {
    }
}
