package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.application.port.out.AdminExecutionQueryPort;
import com.weav.workflow.application.port.out.MonitoringQueryPort.DayCount;
import com.weav.workflow.application.port.out.MonitoringQueryPort.RunFilter;
import com.weav.workflow.application.port.out.MonitoringQueryPort.RunItem;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import com.weav.workflow.domain.valueobject.NodeExecutionStatus;
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
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Cross-workspace run queries for system admins (UC028). Only runs of non-deleted workflows are visible; node
 * input/output are never selected, and error text goes through the same redaction as the workspace views.
 */
@Repository
public class AdminExecutionQueryAdapter implements AdminExecutionQueryPort {
    private static final Pattern SQL_IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");
    private static final String RUN_COLUMNS = """
            e.id, e.workflow_id, w.name AS workflow_name, w.workspace_id, e.status, e.trigger_type,
            e.created_at, e.started_at, e.finished_at,
            e.error ->> 'code' AS error_code, e.error ->> 'message' AS error_message""";

    private final JdbcTemplate jdbc;
    private final String workflowTable;
    private final String executionTable;
    private final String nodeTable;

    public AdminExecutionQueryAdapter(
            JdbcTemplate jdbc,
            @Value("${spring.jpa.properties.hibernate.default_schema:workflow}") String schema) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        if (schema == null || !SQL_IDENTIFIER.matcher(schema).matches()) {
            throw new IllegalArgumentException("schema must be a simple SQL identifier");
        }
        this.workflowTable = schema + ".workflows";
        this.executionTable = schema + ".workflow_executions";
        this.nodeTable = schema + ".node_executions";
    }

    @Override
    @Transactional(readOnly = true)
    public AdminRunPage history(UUID workspaceIdOrNull, RunFilter filter, int page, int size) {
        if (page < 0 || size < 1 || size > 100 || (long) page * size > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("Page bounds are invalid");
        }
        StringBuilder where = new StringBuilder("w.deleted_at IS NULL");
        List<Object> args = new ArrayList<>();
        if (workspaceIdOrNull != null) {
            where.append(" AND w.workspace_id = ?");
            args.add(workspaceIdOrNull);
        }
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
        List<AdminRunItem> items = jdbc.query("""
                SELECT %s
                FROM %s e JOIN %s w ON w.id = e.workflow_id
                WHERE %s
                ORDER BY e.created_at DESC, e.id DESC
                LIMIT ? OFFSET ?
                """.formatted(RUN_COLUMNS, executionTable, workflowTable, where), this::runItem,
                pageArgs.toArray());
        return new AdminRunPage(items, page, size, total);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<AdminRunDetail> detail(UUID executionId) {
        return jdbc.query("""
                SELECT %s
                FROM %s e JOIN %s w ON w.id = e.workflow_id
                WHERE e.id = ? AND w.deleted_at IS NULL
                """.formatted(RUN_COLUMNS, executionTable, workflowTable), this::runItem, executionId)
                .stream().findFirst().map(run -> new AdminRunDetail(run, steps(executionId)));
    }

    @Override
    @Transactional(readOnly = true)
    public AdminCounts counts(Instant from, Instant to) {
        return jdbc.queryForObject("""
                SELECT count(*) AS total,
                       count(*) FILTER (WHERE e.status = 'SUCCESS') AS success,
                       count(*) FILTER (WHERE e.status = 'FAILED') AS failed,
                       count(*) FILTER (WHERE e.status IN ('QUEUED', 'RUNNING', 'WAITING')) AS active
                FROM %s e JOIN %s w ON w.id = e.workflow_id
                WHERE w.deleted_at IS NULL AND e.created_at >= ? AND e.created_at < ?
                """.formatted(executionTable, workflowTable), (rs, row) -> new AdminCounts(
                rs.getLong("total"), rs.getLong("success"), rs.getLong("failed"), rs.getLong("active")),
                Timestamp.from(from), Timestamp.from(to));
    }

    @Override
    @Transactional(readOnly = true)
    public List<DayCount> dayCounts(Instant from, Instant to) {
        return jdbc.query("""
                SELECT (e.created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS total,
                       count(*) FILTER (WHERE e.status = 'SUCCESS') AS success,
                       count(*) FILTER (WHERE e.status = 'FAILED') AS failed
                FROM %s e JOIN %s w ON w.id = e.workflow_id
                WHERE w.deleted_at IS NULL AND e.created_at >= ? AND e.created_at < ?
                GROUP BY 1 ORDER BY 1
                """.formatted(executionTable, workflowTable), (rs, row) -> new DayCount(
                rs.getObject("day", LocalDate.class), rs.getLong("total"), rs.getLong("success"),
                rs.getLong("failed")), Timestamp.from(from), Timestamp.from(to));
    }

    @Override
    @Transactional(readOnly = true)
    public List<AdminFailingWorkflow> topFailing(Instant from, Instant to, int limit) {
        return jdbc.query("""
                SELECT w.id, w.name, w.workspace_id, count(*) AS failures, max(e.created_at) AS last_failure
                FROM %s e JOIN %s w ON w.id = e.workflow_id
                WHERE w.deleted_at IS NULL AND e.status = 'FAILED' AND e.created_at >= ? AND e.created_at < ?
                GROUP BY w.id, w.name, w.workspace_id
                ORDER BY failures DESC, last_failure DESC, w.id
                LIMIT ?
                """.formatted(executionTable, workflowTable), (rs, row) -> new AdminFailingWorkflow(
                rs.getObject("id", UUID.class), rs.getString("name"), rs.getObject("workspace_id", UUID.class),
                rs.getLong("failures"), instant(rs, "last_failure")),
                Timestamp.from(from), Timestamp.from(to), limit);
    }

    private List<AdminStep> steps(UUID executionId) {
        return jdbc.query("""
                SELECT node_id, node_type, status, attempt_count, started_at, finished_at,
                       error ->> 'code' AS error_code, error ->> 'message' AS error_message
                FROM %s
                WHERE execution_id = ?
                ORDER BY created_at, id
                """.formatted(nodeTable), (rs, row) -> new AdminStep(
                rs.getString("node_id"), rs.getString("node_type"),
                NodeExecutionStatus.valueOf(rs.getString("status")), rs.getInt("attempt_count"),
                instant(rs, "started_at"), instant(rs, "finished_at"),
                ExecutionQueryAdapter.sanitizeString(rs.getString("error_code")),
                ExecutionQueryAdapter.sanitizeRunError(rs.getString("error_message"))), executionId);
    }

    private AdminRunItem runItem(ResultSet rs, int row) throws SQLException {
        return new AdminRunItem(new RunItem(
                rs.getObject("id", UUID.class), rs.getObject("workflow_id", UUID.class),
                rs.getString("workflow_name"), ExecutionStatus.valueOf(rs.getString("status")),
                ExecutionTriggerType.valueOf(rs.getString("trigger_type")), instant(rs, "created_at"),
                instant(rs, "started_at"), instant(rs, "finished_at"),
                ExecutionQueryAdapter.sanitizeString(rs.getString("error_code")),
                ExecutionQueryAdapter.sanitizeRunError(rs.getString("error_message"))),
                rs.getObject("workspace_id", UUID.class));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }
}
