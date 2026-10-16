package com.weav.workspace.infrastructure.metrics;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Component;

/**
 * Last successful run of each scheduled task, in memory only (no queries). Gauge
 * {@code weav.scheduled.task.last.success.timestamp.seconds{task}} is the Unix time of the last run that finished
 * without throwing, and NaN until the first success, so {@code time() - metric > N} alerts never fire spuriously
 * right after a restart. Idle-skipped ticks are not runs. Task names are fixed constants (low cardinality).
 */
@Component
public class ScheduledTaskMetrics {
    public static final String NOTIFICATION_OUTBOX_PUBLISHER = "notification-outbox-publisher";
    public static final String RETENTION_PURGE = "retention-purge";
    private static final List<String> TASKS = List.of(NOTIFICATION_OUTBOX_PUBLISHER, RETENTION_PURGE);

    private final Map<String, AtomicLong> lastSuccessSeconds = new LinkedHashMap<>();

    public ScheduledTaskMetrics(MeterRegistry registry) {
        for (String task : TASKS) {
            AtomicLong seconds = new AtomicLong(0);
            lastSuccessSeconds.put(task, seconds);
            Gauge.builder("weav.scheduled.task.last.success.timestamp.seconds", seconds,
                            s -> s.get() == 0 ? Double.NaN : s.get())
                    .tag("task", task).baseUnit("seconds")
                    .description("Unix time of the last scheduled run that completed without an exception, NaN before the first")
                    .register(registry);
        }
    }

    /** Call at the end of a scheduled run that completed without throwing. */
    public void succeeded(String task) {
        AtomicLong seconds = lastSuccessSeconds.get(task);
        if (seconds == null) {
            throw new IllegalArgumentException("Unknown scheduled task: " + task);
        }
        seconds.set(Instant.now().getEpochSecond());
    }
}
