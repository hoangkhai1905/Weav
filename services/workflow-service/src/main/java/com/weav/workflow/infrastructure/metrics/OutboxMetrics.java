package com.weav.workflow.infrastructure.metrics;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * X-14: outbox backlog gauges. Values are cached and re-queried lazily at most every 30 s (on scrape), so a
 * scrape never costs more than one cheap indexed query per outbox table.
 */
@Component
public class OutboxMetrics {
    private static final Logger LOGGER = LoggerFactory.getLogger(OutboxMetrics.class);
    private static final Pattern SAFE_SCHEMA = Pattern.compile("[A-Za-z_][A-Za-z0-9_]{0,62}");
    private static final long REFRESH_INTERVAL_NANOS = TimeUnit.SECONDS.toNanos(30);

    private final List<Source> sources;

    public OutboxMetrics(JdbcTemplate jdbc, MeterRegistry registry, @Value("${DB_SCHEMA:workflow}") String schema) {
        if (!SAFE_SCHEMA.matcher(schema).matches()) {
            throw new IllegalArgumentException("DB_SCHEMA must be a simple PostgreSQL schema identifier");
        }
        this.sources = List.of(
                new Source(jdbc, schema, "outbox_events", "status = 'PENDING'", "status = 'FAILED'"),
                new Source(jdbc, schema, "notification_outbox", "status in ('PENDING', 'CLAIMED')",
                        "status = 'FAILED'")
        );
        for (Source source : sources) {
            Gauge.builder("weav_outbox_pending", source, s -> s.pending()).tag("outbox", source.name)
                    .description("Outbox rows not yet published and not FAILED").register(registry);
            Gauge.builder("weav_outbox_oldest_pending_age_seconds", source, s -> s.oldestAgeSeconds())
                    .tag("outbox", source.name).baseUnit("seconds")
                    .description("Age of the oldest pending outbox row, 0 when none").register(registry);
            if (source.failedWhere != null) {
                Gauge.builder("weav_outbox_failed", source, s -> s.failed()).tag("outbox", source.name)
                        .description("Outbox rows in the terminal FAILED state").register(registry);
            }
        }
    }

    /** Re-reads every outbox now (used by tests; scrapes go through the 30 s cache). */
    public void refresh() {
        sources.forEach(Source::refresh);
    }

    static final class Source {
        private final JdbcTemplate jdbc;
        private final String name;
        private final String table;
        private final String pendingWhere;
        private final String failedWhere; // null when the outbox has no terminal FAILED state
        private long lastRefreshNanos;
        private boolean refreshed;
        private volatile long pending;
        private volatile double oldestAgeSeconds;
        private volatile long failed;

        Source(JdbcTemplate jdbc, String schema, String name, String pendingWhere, String failedWhere) {
            this.jdbc = jdbc;
            this.name = name;
            this.table = '"' + schema + "\".\"" + name + '"';
            this.pendingWhere = pendingWhere;
            this.failedWhere = failedWhere;
        }

        double pending() {
            refreshIfStale();
            return pending;
        }

        double oldestAgeSeconds() {
            refreshIfStale();
            return oldestAgeSeconds;
        }

        double failed() {
            refreshIfStale();
            return failed;
        }

        private synchronized void refreshIfStale() {
            if (!refreshed || System.nanoTime() - lastRefreshNanos >= REFRESH_INTERVAL_NANOS) {
                refresh();
            }
        }

        synchronized void refresh() {
            // A failed query keeps the previous values: a metrics scrape must never throw.
            try {
                jdbc.query("select count(*), coalesce(extract(epoch from now() - min(created_at)), 0) from "
                        + table + " where " + pendingWhere, rs -> {
                    pending = rs.getLong(1);
                    oldestAgeSeconds = rs.getDouble(2);
                });
                if (failedWhere != null) {
                    Long count = jdbc.queryForObject("select count(*) from " + table + " where " + failedWhere,
                            Long.class);
                    failed = count == null ? 0 : count;
                }
            } catch (RuntimeException ex) {
                LOGGER.warn("Outbox metrics refresh failed for {}: {}", name, ex.toString());
            } finally {
                refreshed = true;
                lastRefreshNanos = System.nanoTime();
            }
        }
    }
}
