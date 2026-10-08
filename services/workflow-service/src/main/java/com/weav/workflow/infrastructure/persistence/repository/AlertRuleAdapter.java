package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.application.notification.WorkflowNotificationEvent;
import com.weav.workflow.application.port.out.AlertRuleStore;
import com.weav.workflow.application.port.out.WorkflowNotificationOutboxPort;
import com.weav.workflow.domain.valueobject.AlertRuleType;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/** Alert rules, firing state and the finished-run facts for the evaluator (workflow schema only). */
@Repository
public class AlertRuleAdapter implements AlertRuleStore {
    private static final Pattern SQL_IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");
    private static final String COLUMNS = "id, workspace_id, workflow_id, name, rule_type, threshold, "
            + "window_minutes, cooldown_minutes, enabled, created_by, created_at, updated_at";
    private static final String R_COLUMNS = "r.id, r.workspace_id, r.workflow_id, r.name, r.rule_type, r.threshold, "
            + "r.window_minutes, r.cooldown_minutes, r.enabled, r.created_by, r.created_at, r.updated_at";

    private final JdbcTemplate jdbc;
    private final WorkflowNotificationOutboxPort notificationOutbox;
    private final String rules;
    private final String firings;
    private final String workflows;
    private final String executions;
    private final RowMapper<AlertRule> ruleMapper = this::rule;

    public AlertRuleAdapter(
            JdbcTemplate jdbc,
            WorkflowNotificationOutboxPort notificationOutbox,
            @Value("${spring.jpa.properties.hibernate.default_schema:workflow}") String schema) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.notificationOutbox = Objects.requireNonNull(notificationOutbox, "notificationOutbox must not be null");
        if (schema == null || !SQL_IDENTIFIER.matcher(schema).matches()) {
            throw new IllegalArgumentException("schema must be a simple SQL identifier");
        }
        this.rules = schema + ".alert_rules";
        this.firings = schema + ".alert_rule_firings";
        this.workflows = schema + ".workflows";
        this.executions = schema + ".workflow_executions";
    }

    @Override
    @Transactional(readOnly = true)
    public List<AlertRule> list(UUID workspaceId) {
        // Rules of a soft-deleted workflow are hidden (and do not count towards the cap).
        return jdbc.query("""
                SELECT %s FROM %s r LEFT JOIN %s w ON w.id = r.workflow_id
                WHERE r.workspace_id = ? AND (r.workflow_id IS NULL OR w.deleted_at IS NULL)
                ORDER BY r.created_at, r.id
                """.formatted(R_COLUMNS, rules, workflows), ruleMapper, workspaceId);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<AlertRule> find(UUID workspaceId, UUID ruleId) {
        return jdbc.query("SELECT %s FROM %s WHERE workspace_id = ? AND id = ?".formatted(COLUMNS, rules),
                ruleMapper, workspaceId, ruleId).stream().findFirst();
    }

    @Override
    @Transactional(readOnly = true)
    public boolean workflowInWorkspace(UUID workspaceId, UUID workflowId) {
        return jdbc.queryForObject("""
                SELECT count(*) FROM %s WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
                """.formatted(workflows), Integer.class, workflowId, workspaceId) == 1;
    }

    @Override
    @Transactional
    public boolean insertIfBelowLimit(AlertRule rule, int maxRules) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", rs -> { },
                "alert_rules:" + rule.workspaceId());
        long existing = jdbc.queryForObject("""
                SELECT count(*) FROM %s r LEFT JOIN %s w ON w.id = r.workflow_id
                WHERE r.workspace_id = ? AND (r.workflow_id IS NULL OR w.deleted_at IS NULL)
                """.formatted(rules, workflows), Long.class, rule.workspaceId());
        if (existing >= maxRules) {
            return false;
        }
        jdbc.update("""
                INSERT INTO %s (id, workspace_id, workflow_id, name, rule_type, threshold, window_minutes,
                                cooldown_minutes, enabled, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """.formatted(rules), rule.id(), rule.workspaceId(), rule.workflowId(), rule.name(),
                rule.type().name(), rule.threshold(), rule.windowMinutes(), rule.cooldownMinutes(), rule.enabled(),
                rule.createdBy(), Timestamp.from(rule.createdAt()), Timestamp.from(rule.updatedAt()));
        return true;
    }

    @Override
    @Transactional
    public boolean update(AlertRule rule) {
        return jdbc.update("""
                UPDATE %s SET workflow_id = ?, name = ?, rule_type = ?, threshold = ?, window_minutes = ?,
                              cooldown_minutes = ?, enabled = ?, updated_at = ?
                WHERE workspace_id = ? AND id = ?
                """.formatted(rules), rule.workflowId(), rule.name(), rule.type().name(), rule.threshold(),
                rule.windowMinutes(), rule.cooldownMinutes(), rule.enabled(), Timestamp.from(rule.updatedAt()),
                rule.workspaceId(), rule.id()) == 1;
    }

    @Override
    @Transactional
    public boolean delete(UUID workspaceId, UUID ruleId) {
        return jdbc.update("DELETE FROM %s WHERE workspace_id = ? AND id = ?".formatted(rules),
                workspaceId, ruleId) == 1;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<FinishedRun> finishedRun(UUID executionId) {
        return jdbc.query("""
                SELECT e.id, e.workflow_id, w.workspace_id, w.name, w.created_by, e.status,
                       e.started_at, e.finished_at
                FROM %s e JOIN %s w ON w.id = e.workflow_id
                WHERE e.id = ? AND w.deleted_at IS NULL AND e.status IN ('SUCCESS', 'FAILED')
                  AND e.finished_at IS NOT NULL
                """.formatted(executions, workflows), (rs, row) -> new FinishedRun(
                rs.getObject("id", UUID.class), rs.getObject("workflow_id", UUID.class),
                rs.getObject("workspace_id", UUID.class), rs.getString("name"),
                rs.getObject("created_by", UUID.class), ExecutionStatus.valueOf(rs.getString("status")),
                instant(rs, "started_at"), instant(rs, "finished_at")), executionId).stream().findFirst();
    }

    @Override
    @Transactional(readOnly = true)
    public List<AlertRule> enabledRules(UUID workspaceId, UUID workflowId) {
        return jdbc.query("""
                SELECT %s FROM %s
                WHERE workspace_id = ? AND enabled AND (workflow_id IS NULL OR workflow_id = ?)
                ORDER BY created_at, id
                """.formatted(COLUMNS, rules), ruleMapper, workspaceId, workflowId);
    }

    @Override
    @Transactional(readOnly = true)
    public List<OverdueRun> overdueRuns(Instant now, int limit) {
        return jdbc.query("""
                SELECT %s, e.id AS execution_id, e.workflow_id AS run_workflow_id, e.status AS run_status,
                       e.started_at AS run_started_at, w.name AS workflow_name, w.created_by AS workflow_created_by
                FROM %s r
                JOIN %s w ON w.workspace_id = r.workspace_id AND w.deleted_at IS NULL
                         AND (r.workflow_id IS NULL OR r.workflow_id = w.id)
                JOIN %s e ON e.workflow_id = w.id AND e.status IN ('RUNNING', 'WAITING')
                         AND e.started_at IS NOT NULL
                WHERE r.enabled AND r.rule_type = 'LONG_RUNNING'
                  AND e.started_at < ?::timestamptz - r.threshold * INTERVAL '1 second'
                  AND NOT EXISTS (SELECT 1 FROM %s f WHERE f.rule_id = r.id AND f.execution_id = e.id)
                ORDER BY e.started_at, e.id
                LIMIT ?
                """.formatted(R_COLUMNS, rules, workflows, executions, firings), (rs, row) -> new OverdueRun(
                rule(rs, row), new FinishedRun(rs.getObject("execution_id", UUID.class),
                        rs.getObject("run_workflow_id", UUID.class), rs.getObject("workspace_id", UUID.class),
                        rs.getString("workflow_name"), rs.getObject("workflow_created_by", UUID.class),
                        ExecutionStatus.valueOf(rs.getString("run_status")), instant(rs, "run_started_at"), null)),
                Timestamp.from(now), limit);
    }

    @Override
    @Transactional(readOnly = true)
    public List<RecentRun> lastFinishedRuns(UUID workflowId, int limit) {
        return jdbc.query("""
                SELECT status, finished_at FROM %s
                WHERE workflow_id = ? AND status IN ('SUCCESS', 'FAILED') AND finished_at IS NOT NULL
                ORDER BY finished_at DESC, id DESC
                LIMIT ?
                """.formatted(executions), (rs, row) -> new RecentRun(
                ExecutionStatus.valueOf(rs.getString("status")), instant(rs, "finished_at")), workflowId, limit);
    }

    /** Own transaction: the caller runs after the execution commit and its failure must stay isolated. */
    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean fire(AlertRule rule, UUID workflowId, UUID executionId, Instant now, Duration cooldown,
                        List<WorkflowNotificationEvent> events) {
        // Serialises concurrent finishes of the same rule+workflow so the cooldown check cannot be raced.
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", rs -> { },
                rule.id() + ":" + workflowId);
        boolean cooling = jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM %s WHERE rule_id = ? AND workflow_id = ? AND fired_at > ?)
                """.formatted(firings), Boolean.class, rule.id(), workflowId, Timestamp.from(now.minus(cooldown)));
        if (cooling) {
            return false;
        }
        int inserted = jdbc.update("""
                INSERT INTO %s (id, rule_id, workflow_id, execution_id, fired_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (rule_id, execution_id) DO NOTHING
                """.formatted(firings), UUID.randomUUID(), rule.id(), workflowId, executionId, Timestamp.from(now));
        if (inserted == 0) {
            return false;
        }
        events.forEach(notificationOutbox::record);
        return true;
    }

    private AlertRule rule(ResultSet rs, int row) throws SQLException {
        int window = rs.getInt("window_minutes");
        Integer windowMinutes = rs.wasNull() ? null : window;
        return new AlertRule(
                rs.getObject("id", UUID.class), rs.getObject("workspace_id", UUID.class),
                rs.getObject("workflow_id", UUID.class), rs.getString("name"),
                AlertRuleType.valueOf(rs.getString("rule_type")), rs.getInt("threshold"), windowMinutes,
                rs.getInt("cooldown_minutes"), rs.getBoolean("enabled"), rs.getObject("created_by", UUID.class),
                instant(rs, "created_at"), instant(rs, "updated_at"));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }
}
