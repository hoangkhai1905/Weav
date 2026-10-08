package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.application.port.out.MonitoringQueryPort;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Workspace-wide run history and the monitoring summary, as bounded SQL aggregates (group-by / FILTER, no
 * per-workflow fan-out). A run's time is {@code created_at} (the same key the per-workflow list sorts by);
 * day buckets are UTC.
 */
@Repository
public class MonitoringQueryAdapter implements MonitoringQueryPort {
    private static final Pattern SQL_IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");
    private static final int MAX_ERROR_MESSAGE = 300;
    private static final int TOP_LIMIT = 5;

    private final JdbcTemplate jdbc;
    private final String workflowTable;
    private final String executionTable;

    public MonitoringQueryAdapter(
            JdbcTemplate jdbc,
            @Value("${spring.jpa.properties.hibernate.default_schema:workflow}") String schema) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        if (schema == null || !SQL_IDENTIFIER.matcher(schema).matches()) {
            throw new IllegalArgumentException("schema must be a simple SQL identifier");
        }
        this.workflowTable = schema + ".workflows";
        this.executionTable = schema + ".workflow_executions";
    }

    @Override
    @Transactional(readOnly = true)
    public RunPage history(UUID workspaceId, RunFilter filter, int page, int size) {
        if (page < 0 || size < 1 || size > 100 || (long) page * size > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("Page bounds are invalid");
        }
        StringBuilder where = new StringBuilder("w.workspace_id = ? AND w.deleted_at IS NULL");
        List<Object> args = new ArrayList<>();
        args.add(workspaceId);
        if (filter.status() != null) {
            where.append(" AND e.status = ?");
            args.add(filter.status().name());
        }
        if (filter.workflowId() != null) {
            where.append(" AND e.workflow_id = ?");
            args.add(filter.workflowId());
        }
        if (filter.from() != null) {
            where.append(" AND e.created_at >= ?");
            args.add(Timestamp.from(filter.from()));
        }
        if (filter.to() != null) {
            where.append(" AND e.created_at < ?");
            args.add(Timestamp.from(filter.to()));
        }
        long total = jdbc.queryForObject(
                "SELECT count(*) FROM %s e JOIN %s w ON w.id = e.workflow_id WHERE %s"
                        .formatted(executionTable, workflowTable, where), Long.class, args.toArray());
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(size);
        pageArgs.add(page * size);
        List<RunItem> items = jdbc.query("""
                SELECT e.id, e.workflow_id, w.name AS workflow_name, e.status, e.trigger_type,
                       e.created_at, e.started_at, e.finished_at,
                       e.error ->> 'code' AS error_code, e.error ->> 'message' AS error_message
                FROM %s e JOIN %s w ON w.id = e.workflow_id
                WHERE %s
                ORDER BY e.created_at DESC, e.id DESC
                LIMIT ? OFFSET ?
                """.formatted(executionTable, workflowTable, where), this::runItem, pageArgs.toArray());
        return new RunPage(items, page, size, total);
    }

    @Override
    @Transactional(readOnly = true)
    public SummaryData summary(UUID workspaceId, Instant from, Instant to, Instant todayStart) {
        long[] counts = new long[3];
        jdbc.query("""
                SELECT status, count(*) AS n FROM %s
                WHERE workspace_id = ? AND deleted_at IS NULL GROUP BY status
                """.formatted(workflowTable), rs -> {
            switch (rs.getString("status")) {
                case "PUBLISHED" -> counts[0] = rs.getLong("n");
                case "PAUSED" -> counts[1] = rs.getLong("n");
                case "DRAFT" -> counts[2] = rs.getLong("n");
                default -> { }
            }
        }, workspaceId);

        RunCounts runs = jdbc.queryForObject("""
                WITH runs AS (
                    SELECT e.status, e.created_at,
                           CASE WHEN e.status IN ('SUCCESS', 'FAILED')
                                 AND e.started_at IS NOT NULL AND e.finished_at IS NOT NULL
                                THEN GREATEST(0, EXTRACT(EPOCH FROM (e.finished_at - e.started_at)) * 1000)
                           END AS ms
                    FROM %s e JOIN %s w ON w.id = e.workflow_id
                    WHERE w.workspace_id = ? AND w.deleted_at IS NULL
                      AND e.created_at >= ? AND e.created_at < ?
                )
                SELECT count(*) AS total,
                       count(*) FILTER (WHERE created_at >= ?) AS today,
                       count(*) FILTER (WHERE status = 'SUCCESS') AS success,
                       count(*) FILTER (WHERE status = 'FAILED') AS failed,
                       count(*) FILTER (WHERE status IN ('QUEUED', 'RUNNING', 'WAITING')) AS active,
                       avg(ms) AS avg_ms,
                       percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95_ms
                FROM runs
                """.formatted(executionTable, workflowTable), (rs, row) -> new RunCounts(
                rs.getLong("total"), rs.getLong("today"), rs.getLong("success"), rs.getLong("failed"),
                rs.getLong("active"), millis(rs, "avg_ms"), millis(rs, "p95_ms")),
                workspaceId, Timestamp.from(from), Timestamp.from(to), Timestamp.from(todayStart));

        List<DayCount> days = jdbc.query("""
                SELECT (e.created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS total,
                       count(*) FILTER (WHERE e.status = 'SUCCESS') AS success,
                       count(*) FILTER (WHERE e.status = 'FAILED') AS failed
                FROM %s e JOIN %s w ON w.id = e.workflow_id
                WHERE w.workspace_id = ? AND w.deleted_at IS NULL
                  AND e.created_at >= ? AND e.created_at < ?
                GROUP BY 1 ORDER BY 1
                """.formatted(executionTable, workflowTable), (rs, row) -> new DayCount(
                rs.getObject("day", LocalDate.class), rs.getLong("total"), rs.getLong("success"),
                rs.getLong("failed")), workspaceId, Timestamp.from(from), Timestamp.from(to));

        List<FailingWorkflow> top = jdbc.query("""
                SELECT w.id, w.name, count(*) AS failures, max(e.created_at) AS last_failure
                FROM %s e JOIN %s w ON w.id = e.workflow_id
                WHERE w.workspace_id = ? AND w.deleted_at IS NULL AND e.status = 'FAILED'
                  AND e.created_at >= ? AND e.created_at < ?
                GROUP BY w.id, w.name
                ORDER BY failures DESC, last_failure DESC, w.id
                LIMIT ?
                """.formatted(executionTable, workflowTable), (rs, row) -> new FailingWorkflow(
                rs.getObject("id", UUID.class), rs.getString("name"), rs.getLong("failures"),
                instant(rs, "last_failure")), workspaceId, Timestamp.from(from), Timestamp.from(to), TOP_LIMIT);

        List<RunItem> recent = jdbc.query("""
                SELECT e.id, e.workflow_id, w.name AS workflow_name, e.status, e.trigger_type,
                       e.created_at, e.started_at, e.finished_at,
                       e.error ->> 'code' AS error_code, e.error ->> 'message' AS error_message
                FROM %s e JOIN %s w ON w.id = e.workflow_id
                WHERE w.workspace_id = ? AND w.deleted_at IS NULL AND e.status = 'FAILED'
                  AND e.created_at >= ? AND e.created_at < ?
                ORDER BY e.created_at DESC, e.id DESC
                LIMIT ?
                """.formatted(executionTable, workflowTable), this::runItem,
                workspaceId, Timestamp.from(from), Timestamp.from(to), TOP_LIMIT);

        return new SummaryData(new WorkflowCounts(counts[0], counts[1], counts[2]), runs, days, top, recent);
    }

    private RunItem runItem(ResultSet rs, int row) throws SQLException {
        String message = ExecutionQueryAdapter.sanitizeString(rs.getString("error_message"));
        if (message != null && message.length() > MAX_ERROR_MESSAGE) {
            message = message.substring(0, MAX_ERROR_MESSAGE) + "…";
        }
        return new RunItem(
                rs.getObject("id", UUID.class), rs.getObject("workflow_id", UUID.class),
                rs.getString("workflow_name"), ExecutionStatus.valueOf(rs.getString("status")),
                ExecutionTriggerType.valueOf(rs.getString("trigger_type")), instant(rs, "created_at"),
                instant(rs, "started_at"), instant(rs, "finished_at"),
                ExecutionQueryAdapter.sanitizeString(rs.getString("error_code")), message);
    }

    private static Long millis(ResultSet rs, String column) throws SQLException {
        double value = rs.getDouble(column);
        return rs.wasNull() ? null : Math.round(value);
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }
}
