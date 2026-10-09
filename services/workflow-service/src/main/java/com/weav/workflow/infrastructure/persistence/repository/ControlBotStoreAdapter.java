package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.application.port.out.ControlBotStore;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/** JDBC reads for the control-bot node and the workflow-event trigger (workflow schema only). */
@Repository
public class ControlBotStoreAdapter implements ControlBotStore {
    private static final Pattern SQL_IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");
    private static final TypeReference<Map<String, Object>> JSON_OBJECT = new TypeReference<>() { };
    private static final int MAX_ERROR_MESSAGE = 300;
    private static final int MAX_WORKFLOWS = 1000;

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final String workflows;
    private final String executions;
    private final String versions;
    private final String triggers;

    public ControlBotStoreAdapter(
            JdbcTemplate jdbc, ObjectMapper objectMapper,
            @Value("${spring.jpa.properties.hibernate.default_schema:workflow}") String schema) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        if (schema == null || !SQL_IDENTIFIER.matcher(schema).matches()) {
            throw new IllegalArgumentException("schema must be a simple SQL identifier");
        }
        this.workflows = schema + ".workflows";
        this.executions = schema + ".workflow_executions";
        this.versions = schema + ".workflow_versions";
        this.triggers = schema + ".workflow_triggers";
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<RunOrigin> runOrigin(UUID executionId) {
        return jdbc.query("""
                SELECT e.id, e.workflow_id, w.workspace_id, v.published_by, e.trigger_type, e.idempotency_key
                FROM %s e JOIN %s w ON w.id = e.workflow_id JOIN %s v ON v.id = e.workflow_version_id
                WHERE e.id = ?
                """.formatted(executions, workflows, versions), (rs, row) -> new RunOrigin(
                rs.getObject("id", UUID.class), rs.getObject("workflow_id", UUID.class),
                rs.getObject("workspace_id", UUID.class), rs.getObject("published_by", UUID.class),
                ExecutionTriggerType.valueOf(rs.getString("trigger_type")), rs.getString("idempotency_key")),
                executionId).stream().findFirst();
    }

    @Override
    @Transactional(readOnly = true)
    public List<WorkflowRef> workflows(UUID workspaceId) {
        return jdbc.query("""
                SELECT id, name, status FROM %s
                WHERE workspace_id = ? AND deleted_at IS NULL
                ORDER BY created_at DESC, id LIMIT %d
                """.formatted(workflows, MAX_WORKFLOWS), (rs, row) -> new WorkflowRef(
                rs.getObject("id", UUID.class), rs.getString("name"),
                WorkflowStatus.valueOf(rs.getString("status"))), workspaceId);
    }

    @Override
    @Transactional(readOnly = true)
    public Set<UUID> existingWorkflowIds(UUID workspaceId, Set<UUID> ids) {
        if (ids.isEmpty()) {
            return Set.of();
        }
        String marks = String.join(",", ids.stream().map(id -> "?").toList());
        List<Object> args = new ArrayList<>();
        args.add(workspaceId);
        args.addAll(ids);
        return new HashSet<>(jdbc.query("""
                SELECT id FROM %s WHERE workspace_id = ? AND deleted_at IS NULL AND id IN (%s)
                """.formatted(workflows, marks), (rs, row) -> rs.getObject("id", UUID.class), args.toArray()));
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<LastRun> lastFinishedRun(UUID workflowId) {
        return jdbc.query("""
                SELECT id, status, finished_at FROM %s
                WHERE workflow_id = ? AND status IN ('SUCCESS', 'FAILED') AND finished_at IS NOT NULL
                ORDER BY finished_at DESC, id DESC LIMIT 1
                """.formatted(executions), (rs, row) -> new LastRun(
                rs.getObject("id", UUID.class), ExecutionStatus.valueOf(rs.getString("status")),
                instant(rs, "finished_at")), workflowId).stream().findFirst();
    }

    @Override
    @Transactional(readOnly = true)
    public Double successRate(UUID workflowId, Instant since) {
        return jdbc.queryForObject("""
                SELECT CASE WHEN count(*) = 0 THEN NULL
                            ELSE round(count(*) FILTER (WHERE status = 'SUCCESS')::numeric / count(*), 4) END
                FROM %s WHERE workflow_id = ? AND created_at >= ? AND status IN ('SUCCESS', 'FAILED')
                """.formatted(executions), Double.class, workflowId, Timestamp.from(since));
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<FinishedSource> finishedSource(UUID executionId) {
        return jdbc.query("""
                SELECT e.id, e.workflow_id, w.workspace_id, w.name, e.status, e.trigger_type,
                       e.error ->> 'code' AS error_code, e.error ->> 'message' AS error_message,
                       e.started_at, e.finished_at, e.idempotency_key
                FROM %s e JOIN %s w ON w.id = e.workflow_id
                WHERE e.id = ? AND w.deleted_at IS NULL AND e.status IN ('SUCCESS', 'FAILED', 'CANCELLED')
                """.formatted(executions, workflows), (rs, row) -> {
            String message = ExecutionQueryAdapter.sanitizeString(rs.getString("error_message"));
            if (message != null && message.length() > MAX_ERROR_MESSAGE) {
                message = message.substring(0, MAX_ERROR_MESSAGE);
            }
            return new FinishedSource(rs.getObject("id", UUID.class), rs.getObject("workflow_id", UUID.class),
                    rs.getObject("workspace_id", UUID.class), rs.getString("name"),
                    ExecutionStatus.valueOf(rs.getString("status")),
                    ExecutionTriggerType.valueOf(rs.getString("trigger_type")),
                    ExecutionQueryAdapter.sanitizeString(rs.getString("error_code")), message,
                    instant(rs, "started_at"), instant(rs, "finished_at"), rs.getString("idempotency_key"));
        }, executionId).stream().findFirst();
    }

    @Override
    @Transactional(readOnly = true)
    public List<EventListener> eventListeners(UUID workspaceId) {
        return jdbc.query("""
                SELECT t.id, t.workflow_id, t.config::text AS config
                FROM %s t JOIN %s w ON w.id = t.workflow_id
                WHERE w.workspace_id = ? AND w.deleted_at IS NULL AND w.status = 'PUBLISHED'
                  AND w.current_version_id = t.workflow_version_id
                  AND t.type = 'WORKFLOW_EVENT' AND t.status = 'ACTIVE'
                ORDER BY t.created_at, t.id
                """.formatted(triggers, workflows), (rs, row) -> new EventListener(
                rs.getObject("id", UUID.class), rs.getObject("workflow_id", UUID.class),
                config(rs.getString("config"))), workspaceId);
    }

    private Map<String, Object> config(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        return objectMapper.readValue(json, JSON_OBJECT);
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }
}
