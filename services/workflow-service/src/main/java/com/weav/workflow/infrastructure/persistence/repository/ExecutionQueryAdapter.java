package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.application.port.out.ExecutionQueryPort;
import com.weav.workflow.domain.exception.ResourceNotFoundException;
import com.weav.workflow.domain.valueobject.AttemptStatus;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import com.weav.workflow.domain.valueobject.LogLevel;
import com.weav.workflow.domain.valueobject.NodeExecutionStatus;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/** Bounded SQL projections for monitoring; no JPA entity or lazy association reaches HTTP. */
@Repository
public class ExecutionQueryAdapter implements ExecutionQueryPort {
    private static final Pattern SQL_IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");
    private static final Pattern SENSITIVE_KEY = Pattern.compile(
            "(?i).*(password|secret|token|authorization|cookie|api[_-]?key|access[_-]?key|"
                    + "private[_-]?key|client[_-]?secret|credential|signature).*");
    private static final Pattern BEARER = Pattern.compile(
            "(?i)\\bBearer\\s+[A-Za-z0-9._~+/=-]+");
    private static final Pattern KEY_VALUE_SECRET = Pattern.compile(
            "(?i)\\b(?:authorization|password|secret|token|api[_-]?key|apikey|access[_-]?key|"
                    + "client[_-]?secret|credential|signature)\\b\\s*[:=]\\s*[^\\s,;]+");
    private static final Pattern URL_SECRET = Pattern.compile(
            "(?i)([?&])(?:access_token|refresh_token|token|api_key|apikey|signature|sig|"
                    + "client_secret|password)=[^&#\\s]+");
    private static final int MAX_SANITIZED_DEPTH = 32;
    private static final int MAX_STRING_LENGTH = 8_192;

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final String workflowTable;
    private final String executionTable;
    private final String nodeTable;
    private final String attemptTable;
    private final String logTable;

    public ExecutionQueryAdapter(
            JdbcTemplate jdbc,
            ObjectMapper objectMapper,
            @Value("${spring.jpa.properties.hibernate.default_schema:workflow}") String schema) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        String safeSchema = validIdentifier(schema, "schema");
        this.workflowTable = safeSchema + ".workflows";
        this.executionTable = safeSchema + ".workflow_executions";
        this.nodeTable = safeSchema + ".node_executions";
        this.attemptTable = safeSchema + ".node_execution_attempts";
        this.logTable = safeSchema + ".execution_logs";
    }

    @Override
    public ExecutionPage list(UUID workspaceId, UUID workflowId, int page, int size) {
        requireWorkflow(workspaceId, workflowId);
        int offset = checkedOffset(page, size);
        long total = jdbc.queryForObject("""
                SELECT count(*)
                FROM %s e
                JOIN %s w ON w.id = e.workflow_id
                WHERE w.workspace_id = ? AND w.id = ? AND w.deleted_at IS NULL
                """.formatted(executionTable, workflowTable), Long.class, workspaceId, workflowId);
        List<ExecutionSummary> items = jdbc.query("""
                SELECT e.id, e.workflow_id, e.workflow_version_id, e.status, e.trigger_type,
                       e.created_at, e.started_at, e.finished_at
                FROM %s e
                JOIN %s w ON w.id = e.workflow_id
                WHERE w.workspace_id = ? AND w.id = ? AND w.deleted_at IS NULL
                ORDER BY e.created_at DESC, e.id DESC
                LIMIT ? OFFSET ?
                """.formatted(executionTable, workflowTable), this::summary, workspaceId, workflowId, size, offset);
        return new ExecutionPage(items, page, size, total);
    }

    @Override
    public ExecutionDetail detail(UUID workspaceId, UUID workflowId, UUID executionId, UUID actorId,
                                 int logPage, int logSize) {
        ExecutionSummary summary = jdbc.query("""
                SELECT e.id, e.workflow_id, e.workflow_version_id, e.status, e.trigger_type,
                       e.created_at, e.started_at, e.finished_at
                FROM %s e
                JOIN %s w ON w.id = e.workflow_id
                WHERE e.id = ? AND e.workflow_id = ? AND w.workspace_id = ? AND w.deleted_at IS NULL
                """.formatted(executionTable, workflowTable), this::summary, executionId, workflowId, workspaceId)
                .stream()
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Execution not found"));

        List<NodeRow> nodes = jdbc.query("""
                SELECT n.id, n.node_id, n.node_type, n.status, n.attempt_count,
                       n.started_at, n.finished_at, n.output::text AS output_json, n.error::text AS error_json
                FROM %s n
                WHERE n.execution_id = ?
                ORDER BY n.created_at ASC, n.node_id ASC, n.id ASC
                """.formatted(nodeTable), this::nodeRow, executionId);
        Map<UUID, List<AttemptState>> attemptsByNode = attempts(executionId);
        List<NodeState> nodeStates = new ArrayList<>(nodes.size());
        for (NodeRow node : nodes) {
            nodeStates.add(new NodeState(node.id(), node.nodeId(), node.nodeType(), node.status(),
                    node.attemptCount(), node.startedAt(), node.finishedAt(),
                    sanitizeJson(node.outputJson()), sanitizeJson(node.errorJson()),
                    attemptsByNode.getOrDefault(node.id(), List.of())));
        }

        int offset = checkedOffset(logPage, logSize);
        long totalLogs = jdbc.queryForObject(
                "SELECT count(*) FROM %s WHERE execution_id = ?".formatted(logTable),
                Long.class, executionId);
        List<LogEntry> logs = jdbc.query("""
                SELECT l.id, l.node_execution_id, l.attempt_id, l.level, l.event_type,
                       l.message, l.metadata::text AS metadata_json, l.created_at
                FROM %s l
                WHERE l.execution_id = ?
                ORDER BY l.created_at ASC, l.id ASC
                LIMIT ? OFFSET ?
                """.formatted(logTable), this::logEntry, executionId, logSize, offset);
        boolean hasNext = (long) (logPage + 1) * logSize < totalLogs;
        return new ExecutionDetail(summary, nodeStates,
                new LogPage(logs, logPage, logSize, totalLogs, hasNext));
    }

    private Map<UUID, List<AttemptState>> attempts(UUID executionId) {
        Map<UUID, List<AttemptState>> result = new LinkedHashMap<>();
        jdbc.query("""
                SELECT a.node_execution_id, a.id, a.attempt_number, a.status,
                       a.started_at, a.finished_at, a.output::text AS output_json,
                       a.error::text AS error_json
                FROM %s a
                JOIN %s n ON n.id = a.node_execution_id
                WHERE n.execution_id = ?
                ORDER BY n.node_id ASC, a.attempt_number ASC, a.id ASC
                """.formatted(attemptTable, nodeTable), (rs, rowNum) -> {
            UUID nodeId = rs.getObject("node_execution_id", UUID.class);
            result.computeIfAbsent(nodeId, ignored -> new ArrayList<>()).add(new AttemptState(
                    rs.getObject("id", UUID.class),
                    rs.getInt("attempt_number"),
                    AttemptStatus.valueOf(rs.getString("status")),
                    instant(rs, "started_at"),
                    instant(rs, "finished_at"),
                    sanitizeJson(rs.getString("output_json")),
                    sanitizeJson(rs.getString("error_json"))));
            return nodeId;
        }, executionId);
        result.replaceAll((ignored, value) -> List.copyOf(value));
        return result;
    }

    private ExecutionSummary summary(ResultSet rs, int rowNum) throws SQLException {
        return new ExecutionSummary(
                rs.getObject("id", UUID.class),
                rs.getObject("workflow_id", UUID.class),
                rs.getObject("workflow_version_id", UUID.class),
                ExecutionStatus.valueOf(rs.getString("status")),
                ExecutionTriggerType.valueOf(rs.getString("trigger_type")),
                instant(rs, "created_at"),
                instant(rs, "started_at"),
                instant(rs, "finished_at"));
    }

    private NodeRow nodeRow(ResultSet rs, int rowNum) throws SQLException {
        return new NodeRow(
                rs.getObject("id", UUID.class),
                rs.getString("node_id"),
                rs.getString("node_type"),
                NodeExecutionStatus.valueOf(rs.getString("status")),
                nullableInt(rs, "attempt_count"),
                instant(rs, "started_at"),
                instant(rs, "finished_at"),
                rs.getString("output_json"),
                rs.getString("error_json"));
    }

    private LogEntry logEntry(ResultSet rs, int rowNum) throws SQLException {
        Object metadata = sanitizeJson(rs.getString("metadata_json"));
        Map<String, Object> metadataMap = metadata instanceof Map<?, ?> map
                ? castStringMap(map)
                : Map.of();
        return new LogEntry(
                rs.getObject("id", UUID.class),
                rs.getObject("node_execution_id", UUID.class),
                rs.getObject("attempt_id", UUID.class),
                LogLevel.valueOf(rs.getString("level")),
                rs.getString("event_type"),
                sanitizeString(rs.getString("message")),
                metadataMap,
                instant(rs, "created_at"));
    }

    private void requireWorkflow(UUID workspaceId, UUID workflowId) {
        Integer count = jdbc.queryForObject("""
                SELECT count(*)
                FROM %s
                WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
                """.formatted(workflowTable), Integer.class, workflowId, workspaceId);
        if (count == null || count != 1) {
            throw new ResourceNotFoundException("Workflow not found");
        }
    }

    private Object sanitizeJson(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return sanitizeNode(objectMapper.readTree(json), 0);
        } catch (Exception exception) {
            return Map.of(
                    "code", "PERSISTED_DATA_UNAVAILABLE",
                    "message", "Stored execution data is unavailable.");
        }
    }

    private Object sanitizeNode(JsonNode node, int depth) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (depth > MAX_SANITIZED_DEPTH) {
            return "[REDACTED]";
        }
        if (node.isObject()) {
            Map<String, Object> object = new LinkedHashMap<>();
            for (Map.Entry<String, JsonNode> property : node.properties()) {
                if (SENSITIVE_KEY.matcher(property.getKey()).matches()) {
                    continue;
                }
                object.put(property.getKey(), sanitizeNode(property.getValue(), depth + 1));
            }
            return object;
        }
        if (node.isArray()) {
            List<Object> values = new ArrayList<>(node.size());
            for (JsonNode child : node) {
                values.add(sanitizeNode(child, depth + 1));
            }
            return values;
        }
        if (node.isString()) {
            return sanitizeString(node.stringValue());
        }
        if (node.isBoolean()) {
            return node.booleanValue();
        }
        if (node.isNumber()) {
            return node.numberValue();
        }
        return "[REDACTED]";
    }

    private String sanitizeString(String value) {
        if (value == null) {
            return null;
        }
        String sanitized = URL_SECRET.matcher(value).replaceAll("$1[REDACTED]");
        sanitized = BEARER.matcher(sanitized).replaceAll("Bearer [REDACTED]");
        sanitized = KEY_VALUE_SECRET.matcher(sanitized).replaceAll("[REDACTED]");
        return sanitized.length() <= MAX_STRING_LENGTH
                ? sanitized
                : sanitized.substring(0, MAX_STRING_LENGTH) + "…";
    }

    private Map<String, Object> castStringMap(Map<?, ?> map) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            if (entry.getKey() instanceof String key) {
                result.put(key, entry.getValue());
            }
        }
        return result;
    }

    private int checkedOffset(int page, int size) {
        if (page < 0 || size < 1 || size > 100) {
            throw new IllegalArgumentException("Page bounds are invalid");
        }
        long offset = (long) page * size;
        if (offset > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("Page offset is out of range");
        }
        return (int) offset;
    }

    private static int nullableInt(ResultSet rs, String column) throws SQLException {
        int value = rs.getInt(column);
        return rs.wasNull() ? 0 : value;
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private static String validIdentifier(String value, String name) {
        if (value == null || !SQL_IDENTIFIER.matcher(value).matches()) {
            throw new IllegalArgumentException(name + " must be a simple SQL identifier");
        }
        return value;
    }

    private record NodeRow(UUID id, String nodeId, String nodeType, NodeExecutionStatus status,
                           int attemptCount, Instant startedAt, Instant finishedAt,
                           String outputJson, String errorJson) {
    }
}
