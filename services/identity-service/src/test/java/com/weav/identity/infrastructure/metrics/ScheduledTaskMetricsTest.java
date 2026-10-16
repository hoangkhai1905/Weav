package com.weav.identity.infrastructure.metrics;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.weav.identity.infrastructure.persistence.SessionRetentionPurgeJob;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

class ScheduledTaskMetricsTest {
    private static final String GAUGE = "weav.scheduled.task.last.success.timestamp.seconds";

    private final MeterRegistry registry = new SimpleMeterRegistry();
    private final ScheduledTaskMetrics metrics = new ScheduledTaskMetrics(registry);

    private double gauge(String task) {
        return registry.get(GAUGE).tag("task", task).gauge().value();
    }

    @Test
    void gaugeIsNaNUntilFirstSuccessThenHoldsEpochSeconds() {
        assertThat(gauge(ScheduledTaskMetrics.SESSION_PURGE)).isNaN();
        long before = Instant.now().getEpochSecond();

        metrics.succeeded(ScheduledTaskMetrics.SESSION_PURGE);

        assertThat(gauge(ScheduledTaskMetrics.SESSION_PURGE)).isBetween((double) before, (double) Instant.now().getEpochSecond());
    }

    @Test
    void unknownTaskIsRejectedToKeepCardinalityBounded() {
        assertThatThrownBy(() -> metrics.succeeded("whatever")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @SuppressWarnings("unchecked")
    void scheduledRunUpdatesGaugeOnSuccessAndNotOnFailure() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        PlatformTransactionManager tm = mock(PlatformTransactionManager.class);
        SessionRetentionPurgeJob job = new SessionRetentionPurgeJob(jdbc, tm, "identity", 30);
        job.configureTaskMetrics(metrics);
        when(jdbc.queryForObject(any(String.class), any(Class.class), anyLong()))
                .thenThrow(new IllegalStateException("db down"));

        assertThatThrownBy(job::purgeOnSchedule).isInstanceOf(RuntimeException.class);
        assertThat(gauge(ScheduledTaskMetrics.SESSION_PURGE)).isNaN();

        when(jdbc.queryForObject(any(String.class), any(Class.class), anyLong())).thenReturn(Boolean.TRUE);
        job.purgeOnSchedule();
        assertThat(gauge(ScheduledTaskMetrics.SESSION_PURGE)).isGreaterThan(0);
    }
}
