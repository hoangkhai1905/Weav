package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.application.port.out.ExecutionRecoveryPort;
import com.weav.workflow.application.port.out.ExecutionStatePort;
import com.weav.workflow.domain.definition.JsonValues;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.execution.GraphState;
import com.weav.workflow.domain.model.aggregate.execution.ExecutionLog;
import com.weav.workflow.domain.model.aggregate.execution.NodeExecution;
import com.weav.workflow.domain.model.aggregate.execution.NodeExecutionAttempt;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowVersion;
import com.weav.workflow.domain.valueobject.AttemptStatus;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import com.weav.workflow.domain.valueobject.LogLevel;
import com.weav.workflow.domain.valueobject.NodeExecutionStatus;
import com.weav.workflow.infrastructure.definition.DefinitionJsonCodec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/** PostgreSQL lease fencing, execution snapshots, and bounded recovery claims. */
@Repository
public class ExecutionStateAdapter implements ExecutionStatePort, ExecutionRecoveryPort {
    private static final Pattern SQL_IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");
    private static final String RECOVERY_AGGREGATE = "WORKFLOW_EXECUTION";
    private static final String RECOVERY_EVENT = "EXECUTION_REQUESTED";
    private static final int MAX_LEASE_MILLIS = 86_400_000;
    private static final String LEGACY_ERROR = "{\"code\":\"LEGACY_STATE_UNRECOVERABLE\","
            + "\"message\":\"Persisted execution state could not be recovered.\"}";
    private static final String INTERRUPTED_ERROR = "{\"code\":\"WORKER_INTERRUPTED\","
            + "\"message\":\"The worker stopped before the node attempt completed.\"}";

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final DefinitionJsonCodec definitionCodec;
    private final RowMapper<NodeExecution> nodeRowMapper = this::mapNodeRow;
    private final RowMapper<NodeExecutionAttempt> attemptRowMapper = this::mapAttemptRow;
    private final String executionTable;
    private final String workflowTable;
    private final String versionTable;
    private final String triggerTable;
    private final String nodeTable;
    private final String attemptTable;
    private final String logTable;
    private final String outboxTable;

    public ExecutionStateAdapter(JdbcTemplate jdbc, ObjectMapper objectMapper,
                                 @Value("${spring.jpa.properties.hibernate.default_schema:workflow}") String schema) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        if (schema == null || !SQL_IDENTIFIER.matcher(schema).matches()) {
            throw new IllegalArgumentException("The configured workflow schema name is invalid");
        }
        String qualified = "\"" + schema + "\".";
        executionTable = qualified + "workflow_executions";
        workflowTable = qualified + "workflows";
        versionTable = qualified + "workflow_versions";
        triggerTable = qualified + "workflow_triggers";
        nodeTable = qualified + "node_executions";
        attemptTable = qualified + "node_execution_attempts";
        logTable = qualified + "execution_logs";
        outboxTable = qualified + "outbox_events";
        definitionCodec = new DefinitionJsonCodec(objectMapper);
    }

    @Override
    @Transactional
    public Optional<Lease> claim(UUID executionId, String owner, Duration leaseDuration) {
        Objects.requireNonNull(executionId, "executionId must not be null");
        validateOwner(owner);
        long leaseMillis = boundedLeaseMillis(leaseDuration);
        List<ClaimRow> rows = jdbc.query("""
                SELECT e.id, e.workflow_id, e.workflow_version_id, e.trigger_id, e.trigger_type,
                       e.status, e.root_node_id, e.lease_token,
                       e.lease_until > CURRENT_TIMESTAMP AS lease_active,
                       v.workflow_id AS version_workflow_id, v.version_number,
                       v.definition::text AS version_definition, v.schema_version AS version_schema_version,
                       v.published_by, v.created_at AS version_created_at
                FROM %s e
                LEFT JOIN %s v ON v.id = e.workflow_version_id
                WHERE e.id = ?
                FOR UPDATE OF e SKIP LOCKED
                """.formatted(executionTable, versionTable), CLAIM_ROW_MAPPER, executionId);
        if (rows.isEmpty()) {
            return Optional.empty();
        }

        ClaimRow row = rows.getFirst();
        if (!ExecutionStatus.QUEUED.name().equals(row.status())
                && !ExecutionStatus.RUNNING.name().equals(row.status())) {
            return Optional.empty();
        }
        if (row.leaseActive()) {
            return Optional.empty();
        }
        if (!hasRecoverablePinnedState(row) || isInconsistentRunningState(executionId, row.status())) {
            failLegacyState(executionId);
            return Optional.empty();
        }

        List<Long> tokens = jdbc.query("""
                UPDATE %s
                SET lease_owner = ?, lease_token = lease_token + 1,
                    lease_until = CURRENT_TIMESTAMP + (? * INTERVAL '1 millisecond'),
                    status = 'RUNNING', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
                WHERE id = ? AND status IN ('QUEUED', 'RUNNING')
                  AND (lease_until IS NULL OR lease_until < CURRENT_TIMESTAMP)
                RETURNING lease_token
                """.formatted(executionTable), (rs, rowNum) -> rs.getLong(1), owner, leaseMillis, executionId);
        if (tokens.isEmpty()) {
            return Optional.empty();
        }

        if (ExecutionStatus.RUNNING.name().equals(row.status())) {
            recordInterruptedAttempts(executionId);
        }
        return Optional.of(new Lease(executionId, owner, tokens.getFirst()));
    }

    @Override
    @Transactional
    public boolean renew(Lease lease, Duration leaseDuration) {
        Objects.requireNonNull(lease, "lease must not be null");
        long leaseMillis = boundedLeaseMillis(leaseDuration);
        return jdbc.update("""
                UPDATE %s
                SET lease_until = CURRENT_TIMESTAMP + (? * INTERVAL '1 millisecond')
                WHERE id = ? AND status = 'RUNNING' AND lease_owner = ? AND lease_token = ?
                  AND lease_until > CURRENT_TIMESTAMP
                """.formatted(executionTable), leaseMillis, lease.executionId(), lease.owner(), lease.token()) == 1;
    }

    @Override
    @Transactional(readOnly = true)
    public Snapshot load(Lease lease) {
        Objects.requireNonNull(lease, "lease must not be null");
        List<SnapshotRow> rows = jdbc.query("""
                SELECT e.workflow_id, w.workspace_id, e.workflow_version_id, e.trigger_id,
                       e.trigger_type, e.root_node_id, e.input::text AS input_json,
                       e.edge_states::text AS edge_states_json, e.correlation_id, e.traceparent, e.status,
                       v.workflow_id AS version_workflow_id, v.version_number,
                       v.definition::text AS version_definition, v.schema_version AS version_schema_version,
                       v.published_by, v.created_at AS version_created_at
                FROM %s e
                JOIN %s w ON w.id = e.workflow_id
                LEFT JOIN %s v ON v.id = e.workflow_version_id
                WHERE e.id = ? AND e.status = 'RUNNING' AND e.lease_owner = ? AND e.lease_token = ?
                  AND e.lease_until > CURRENT_TIMESTAMP
                """.formatted(executionTable, workflowTable, versionTable), SNAPSHOT_ROW_MAPPER,
                lease.executionId(), lease.owner(), lease.token());
        if (rows.isEmpty()) {
            throw new IllegalStateException("Execution lease is no longer valid");
        }
        SnapshotRow row = rows.getFirst();
        if (!hasRecoverablePinnedState(row)) {
            throw new IllegalStateException("Persisted execution state could not be recovered");
        }

        WorkflowDefinition definition = decodeDefinition(row.versionDefinition());
        WorkflowVersion version = new WorkflowVersion(row.versionId(), row.workflowId(), row.versionNumber(),
                definitionObject(row.versionDefinition()), row.versionSchemaVersion(), row.publishedBy(),
                row.versionCreatedAt());
        Map<String, NodeExecution> nodes = loadNodes(lease.executionId(), definition);
        Map<String, GraphState.EdgeState> edges = loadEdges(row.edgeStatesJson(), definition);
        Map<String, NodeExecutionStatus> nodeStatuses = new LinkedHashMap<>();
        nodes.forEach((nodeId, node) -> nodeStatuses.put(nodeId, node.getStatus()));
        GraphState graph = new GraphState(nodeStatuses, edges);
        List<NodeExecutionAttempt> attempts = loadAttempts(lease.executionId());
        Map<String, Instant> nextAttempts = new LinkedHashMap<>();
        nodes.forEach((nodeId, node) -> {
            if (node.getNextAttemptAt() != null) {
                nextAttempts.put(nodeId, node.getNextAttemptAt());
            }
        });
        Object input = jsonValue(parseJson(row.inputJson()));
        return new Snapshot(row.workflowId(), row.workspaceId(), version, definition, row.rootNodeId(), input,
                graph, nodes, attempts, nextAttempts, row.correlationId(), row.traceparent(),
                ExecutionStatus.valueOf(row.status()));
    }

    @Override
    @Transactional
    public boolean commit(Lease lease, Transition transition) {
        Objects.requireNonNull(lease, "lease must not be null");
        Objects.requireNonNull(transition, "transition must not be null");
        validateTransition(transition);
        List<UUID> fencedRows = jdbc.query("""
                SELECT id FROM %s
                WHERE id = ? AND status = 'RUNNING' AND lease_owner = ? AND lease_token = ?
                  AND lease_until > CURRENT_TIMESTAMP
                FOR UPDATE
                """.formatted(executionTable), (rs, rowNum) -> rs.getObject(1, UUID.class),
                lease.executionId(), lease.owner(), lease.token());
        if (fencedRows.isEmpty()) {
            return false;
        }

        Map<String, NodeExecution> nodes = transitionNodes(transition);
        List<StoredNode> storedNodes = jdbc.query("""
                SELECT id, node_id FROM %s WHERE execution_id = ? ORDER BY node_id FOR UPDATE
                """.formatted(nodeTable), (rs, rowNum) -> new StoredNode(
                rs.getObject("id", UUID.class), rs.getString("node_id")), lease.executionId());
        Set<String> storedNodeIds = new LinkedHashSet<>();
        Map<String, UUID> storedNodePks = new LinkedHashMap<>();
        for (StoredNode stored : storedNodes) {
            storedNodeIds.add(stored.nodeId());
            storedNodePks.put(stored.nodeId(), stored.id());
        }
        if (!storedNodeIds.equals(nodes.keySet()) || !transition.graph().nodes().keySet().equals(nodes.keySet())) {
            throw new IllegalArgumentException("Execution transition nodes do not match persisted execution nodes");
        }
        if (!storedNodePks.keySet().containsAll(transition.nextAttempts().keySet())) {
            throw new IllegalArgumentException("Execution retry state references an unknown node");
        }
        validateNodeStatuses(transition, nodes);

        Set<String> edgeIds = readEdgeIds(lease.executionId());
        if (!edgeIds.equals(transition.graph().edges().keySet())) {
            throw new IllegalArgumentException("Execution transition edges do not match persisted execution edges");
        }
        String edgeJson = writeJson(edgeJsonValues(transition.graph()));
        String outputJson = transition.output() == null ? null : writeJson(transition.output());
        String errorJson = transition.error() == null ? null : writeJson(transition.error());
        boolean terminal = isTerminal(transition.status());
        int updated = jdbc.update("""
                UPDATE %s
                SET status = ?, output = CAST(? AS jsonb), error = CAST(? AS jsonb),
                    edge_states = CAST(? AS jsonb), finished_at = ?,
                    lease_owner = CASE WHEN ? THEN NULL ELSE lease_owner END,
                    lease_until = CASE WHEN ? THEN NULL ELSE lease_until END
                WHERE id = ? AND status = 'RUNNING' AND lease_owner = ? AND lease_token = ?
                  AND lease_until > CURRENT_TIMESTAMP
                """.formatted(executionTable), transition.status().name(), outputJson, errorJson, edgeJson,
                timestamp(transition.finishedAt()), terminal, terminal, lease.executionId(), lease.owner(),
                lease.token());
        if (updated != 1) {
            return false;
        }

        for (NodeExecution node : nodes.values()) {
            Instant nextAttemptAt = transition.nextAttempts().get(node.getNodeId());
            int nodeUpdated = jdbc.update("""
                    UPDATE %s
                    SET status = ?, input = CAST(? AS jsonb), output = CAST(? AS jsonb),
                        error = CAST(? AS jsonb), attempt_count = ?, started_at = ?, finished_at = ?,
                        next_attempt_at = ?
                    WHERE id = ? AND execution_id = ?
                    """.formatted(nodeTable), node.getStatus().name(), writeJson(node.getInput()),
                    writeJson(node.getOutput()), writeJson(node.getError()), node.getAttemptCount(),
                    timestamp(node.getStartedAt()), timestamp(node.getFinishedAt()), timestamp(nextAttemptAt),
                    node.getId(), lease.executionId());
            if (nodeUpdated != 1) {
                throw new IllegalStateException("Execution node disappeared during its fenced transition");
            }
        }
        for (NodeExecutionAttempt attempt : transition.attempts()) {
            persistAttempt(attempt);
        }
        for (ExecutionLog log : transition.logs()) {
            persistLog(lease.executionId(), log);
        }
        return true;
    }

    @Override
    @Transactional
    public void release(Lease lease) {
        Objects.requireNonNull(lease, "lease must not be null");
        jdbc.update("""
                UPDATE %s SET lease_owner = NULL, lease_until = NULL
                WHERE id = ? AND status = 'RUNNING' AND lease_owner = ? AND lease_token = ?
                  AND lease_until > CURRENT_TIMESTAMP
                """.formatted(executionTable), lease.executionId(), lease.owner(), lease.token());
    }

    @Override
    @Transactional
    public int enqueueRecoverable(int batchSize, Duration queuedDeliveryAge, Duration outboxCooldown) {
        if (batchSize < 1 || batchSize > 1_000) {
            throw new IllegalArgumentException("Recovery batch size must be between one and one thousand");
        }
        long queuedAgeMillis = boundedNonNegativeMillis(queuedDeliveryAge, "queuedDeliveryAge");
        long cooldownMillis = boundedNonNegativeMillis(outboxCooldown, "outboxCooldown");
        List<UUID> candidates = jdbc.query("""
                SELECT e.id
                FROM %s e
                WHERE (
                    e.status = 'QUEUED'
                    AND e.created_at <= CURRENT_TIMESTAMP - (? * INTERVAL '1 millisecond')
                    OR e.status = 'RUNNING'
                    AND (e.lease_until IS NULL OR e.lease_until < CURRENT_TIMESTAMP)
                )
                AND NOT EXISTS (
                    SELECT 1 FROM %s pending
                    WHERE pending.aggregate_type = ? AND pending.aggregate_id = e.id
                      AND pending.event_type = ? AND pending.status = 'PENDING'
                )
                AND NOT EXISTS (
                    SELECT 1 FROM %s recent
                    WHERE recent.aggregate_type = ? AND recent.aggregate_id = e.id
                      AND recent.event_type = ?
                      AND recent.created_at >= CURRENT_TIMESTAMP - (? * INTERVAL '1 millisecond')
                )
                ORDER BY e.created_at, e.id
                LIMIT ?
                FOR UPDATE OF e SKIP LOCKED
                """.formatted(executionTable, outboxTable, outboxTable),
                (rs, rowNum) -> rs.getObject(1, UUID.class), queuedAgeMillis,
                RECOVERY_AGGREGATE, RECOVERY_EVENT, RECOVERY_AGGREGATE, RECOVERY_EVENT,
                cooldownMillis, batchSize);
        for (UUID executionId : candidates) {
            jdbc.update("""
                    INSERT INTO %s (id, aggregate_type, aggregate_id, event_type, payload, status,
                                    created_at, retry_count, next_attempt_at)
                    VALUES (?, ?, ?, ?, CAST(? AS jsonb), 'PENDING', CURRENT_TIMESTAMP, 0, CURRENT_TIMESTAMP)
                    """.formatted(outboxTable), UUID.randomUUID(), RECOVERY_AGGREGATE, executionId,
                    RECOVERY_EVENT, writeJson(Map.of("executionId", executionId.toString())));
        }
        return candidates.size();
    }

    private Map<String, NodeExecution> loadNodes(UUID executionId, WorkflowDefinition definition) {
        List<NodeExecution> rows = jdbc.query("""
                SELECT id, execution_id, node_id, node_type, status, input::text AS input_json,
                       output::text AS output_json, error::text AS error_json, attempt_count,
                       started_at, finished_at, created_at, next_attempt_at
                FROM %s WHERE execution_id = ? ORDER BY node_id
                """.formatted(nodeTable), nodeRowMapper, executionId);
        Map<String, NodeExecution> nodes = new LinkedHashMap<>();
        rows.forEach(node -> {
            if (nodes.putIfAbsent(node.getNodeId(), node) != null) {
                throw new IllegalStateException("Persisted execution node identifiers are duplicated");
            }
        });
        Map<String, String> definitionTypes = new LinkedHashMap<>();
        for (WorkflowDefinition.Node node : definition.nodes()) {
            if (node == null || node.id() == null || node.type() == null
                    || definitionTypes.putIfAbsent(node.id(), node.type()) != null) {
                throw new IllegalStateException("Persisted workflow definition has invalid node identifiers");
            }
        }
        if (!definitionTypes.keySet().equals(nodes.keySet())) {
            throw new IllegalStateException("Persisted execution nodes do not match their pinned workflow version");
        }
        nodes.forEach((id, node) -> {
            if (!definitionTypes.get(id).equals(node.getNodeType())) {
                throw new IllegalStateException("Persisted execution node type does not match its pinned version");
            }
        });
        return nodes;
    }

    private List<NodeExecutionAttempt> loadAttempts(UUID executionId) {
        return jdbc.query("""
                SELECT a.id, a.node_execution_id, a.attempt_number, a.status,
                       a.input::text AS input_json, a.output::text AS output_json, a.error::text AS error_json,
                       a.started_at, a.finished_at, a.created_at
                FROM %s a JOIN %s n ON n.id = a.node_execution_id
                WHERE n.execution_id = ? ORDER BY n.node_id, a.attempt_number
                """.formatted(attemptTable, nodeTable), attemptRowMapper, executionId);
    }

    private Map<String, GraphState.EdgeState> loadEdges(String edgeJson, WorkflowDefinition definition) {
        Map<String, Object> stored = objectMap(parseJson(edgeJson), "Persisted execution edge state is malformed");
        Map<String, GraphState.EdgeState> edges = new LinkedHashMap<>();
        Set<String> definitionIds = new LinkedHashSet<>();
        for (WorkflowDefinition.Edge edge : definition.edges()) {
            if (edge == null || edge.id() == null || !definitionIds.add(edge.id())) {
                throw new IllegalStateException("Persisted workflow definition has invalid edge identifiers");
            }
            Object value = stored.get(edge.id());
            if (value == null) {
                edges.put(edge.id(), GraphState.EdgeState.UNKNOWN);
            } else if (value instanceof String name) {
                try {
                    edges.put(edge.id(), GraphState.EdgeState.valueOf(name));
                } catch (IllegalArgumentException exception) {
                    throw new IllegalStateException("Persisted execution edge state is invalid");
                }
            } else {
                throw new IllegalStateException("Persisted execution edge state is invalid");
            }
        }
        if (!definitionIds.containsAll(stored.keySet())) {
            throw new IllegalStateException("Persisted execution state contains an unknown workflow edge");
        }
        return edges;
    }

    private Set<String> readEdgeIds(UUID executionId) {
        List<String> encoded = jdbc.query("""
                SELECT edge_states::text FROM %s WHERE id = ?
                """.formatted(executionTable), (rs, rowNum) -> rs.getString(1), executionId);
        if (encoded.isEmpty()) {
            throw new IllegalStateException("Persisted execution does not exist");
        }
        return objectMap(parseJson(encoded.getFirst()), "Persisted execution edge state is malformed").keySet();
    }

    private boolean hasRecoverablePinnedState(ClaimRow row) {
        if (row.versionWorkflowId() == null || !row.workflowId().equals(row.versionWorkflowId())
                || row.versionNumber() == null || row.versionDefinition() == null
                || row.versionSchemaVersion() == null || row.publishedBy() == null || row.versionCreatedAt() == null
                || row.rootNodeId() == null || row.rootNodeId().isBlank()) {
            return false;
        }
        WorkflowDefinition definition;
        try {
            definition = decodeDefinition(row.versionDefinition());
        } catch (RuntimeException exception) {
            return false;
        }
        String expectedType = triggerNodeType(row.triggerType());
        if (expectedType == null || !definition.schemaVersion().equals(row.versionSchemaVersion())) {
            return false;
        }
        long rootMatches = definition.nodes().stream()
                .filter(Objects::nonNull)
                .filter(node -> row.rootNodeId().equals(node.id()) && expectedType.equals(node.type()))
                .count();
        boolean rootHasIncoming = definition.edges().stream()
                .filter(Objects::nonNull)
                .anyMatch(edge -> row.rootNodeId().equals(edge.target()));
        if (rootMatches != 1 || rootHasIncoming) {
            return false;
        }
        if (row.triggerId() == null) {
            return ExecutionTriggerType.MANUAL.name().equals(row.triggerType());
        }
        String registrationType = triggerRegistrationType(row.triggerType());
        if (registrationType == null) {
            return false;
        }
        Integer registrationCount = jdbc.queryForObject("""
                SELECT count(*) FROM %s
                WHERE id = ? AND workflow_id = ? AND workflow_version_id = ?
                  AND trigger_node_id = ? AND type = ?
                """.formatted(triggerTable), Integer.class, row.triggerId(), row.workflowId(),
                row.versionId(), row.rootNodeId(), registrationType);
        return registrationCount != null && registrationCount == 1;
    }

    private boolean hasRecoverablePinnedState(SnapshotRow row) {
        if (row.versionId() == null || row.versionWorkflowId() == null
                || !row.workflowId().equals(row.versionWorkflowId())
                || row.versionNumber() == null || row.versionDefinition() == null
                || row.versionSchemaVersion() == null || row.publishedBy() == null || row.versionCreatedAt() == null
                || row.rootNodeId() == null || row.rootNodeId().isBlank()) {
            return false;
        }
        ClaimRow claimRow = new ClaimRow(null, row.workflowId(), row.versionId(), row.triggerId(), row.triggerType(),
                row.status(), row.rootNodeId(), 0L, false, row.versionWorkflowId(), row.versionNumber(),
                row.versionDefinition(), row.versionSchemaVersion(), row.publishedBy(), row.versionCreatedAt());
        return hasRecoverablePinnedState(claimRow);
    }

    private boolean isInconsistentRunningState(UUID executionId, String executionStatus) {
        if (!ExecutionStatus.RUNNING.name().equals(executionStatus)) {
            return false;
        }
        Integer inconsistent = jdbc.queryForObject("""
                SELECT count(*) FROM %s n
                WHERE n.execution_id = ? AND n.status = 'RUNNING'
                  AND (n.attempt_count < 1 OR NOT EXISTS (
                      SELECT 1 FROM %s a WHERE a.node_execution_id = n.id
                        AND a.attempt_number = n.attempt_count AND a.status = 'RUNNING'
                  ))
                """.formatted(nodeTable, attemptTable), Integer.class, executionId);
        Integer orphanedAttempts = jdbc.queryForObject("""
                SELECT count(*) FROM %s a JOIN %s n ON n.id = a.node_execution_id
                WHERE n.execution_id = ? AND a.status = 'RUNNING'
                  AND (n.status <> 'RUNNING' OR a.attempt_number <> n.attempt_count)
                """.formatted(attemptTable, nodeTable), Integer.class, executionId);
        return inconsistent != null && inconsistent > 0 || orphanedAttempts != null && orphanedAttempts > 0;
    }

    private void recordInterruptedAttempts(UUID executionId) {
        jdbc.update("""
                UPDATE %s a SET status = 'FAILED', error = CAST(? AS jsonb), finished_at = CURRENT_TIMESTAMP
                FROM %s n
                WHERE n.execution_id = ? AND n.status = 'RUNNING' AND a.node_execution_id = n.id
                  AND a.attempt_number = n.attempt_count AND a.status = 'RUNNING'
                """.formatted(attemptTable, nodeTable), INTERRUPTED_ERROR, executionId);
        jdbc.update("""
                UPDATE %s
                SET status = CASE WHEN attempt_count BETWEEN 1 AND 2 THEN 'WAITING' ELSE 'FAILED' END,
                    error = CAST(? AS jsonb),
                    next_attempt_at = CASE
                        WHEN attempt_count = 1 THEN CURRENT_TIMESTAMP + INTERVAL '1 second'
                        WHEN attempt_count = 2 THEN CURRENT_TIMESTAMP + INTERVAL '2 seconds'
                        ELSE NULL END,
                    finished_at = CASE WHEN attempt_count >= 3 THEN CURRENT_TIMESTAMP ELSE NULL END
                WHERE execution_id = ? AND status = 'RUNNING'
                """.formatted(nodeTable), INTERRUPTED_ERROR, executionId);
    }

    private void failLegacyState(UUID executionId) {
        jdbc.update("""
                UPDATE %s a SET status = 'FAILED', error = CAST(? AS jsonb), finished_at = CURRENT_TIMESTAMP
                FROM %s n
                WHERE n.execution_id = ? AND a.node_execution_id = n.id AND a.status = 'RUNNING'
                """.formatted(attemptTable, nodeTable), LEGACY_ERROR, executionId);
        jdbc.update("""
                UPDATE %s SET status = 'FAILED', error = CAST(? AS jsonb),
                    next_attempt_at = NULL, finished_at = CURRENT_TIMESTAMP
                WHERE execution_id = ? AND status NOT IN ('SUCCESS', 'SKIPPED', 'FAILED', 'CANCELLED')
                """.formatted(nodeTable), LEGACY_ERROR, executionId);
        jdbc.update("""
                UPDATE %s SET status = 'FAILED', error = CAST(? AS jsonb),
                    finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP),
                    lease_owner = NULL, lease_until = NULL
                WHERE id = ? AND status IN ('QUEUED', 'RUNNING')
                """.formatted(executionTable), LEGACY_ERROR, executionId);
    }

    private void validateTransition(Transition transition) {
        boolean terminal = isTerminal(transition.status());
        if (terminal && transition.finishedAt() == null || !terminal && transition.finishedAt() != null) {
            throw new IllegalArgumentException("Terminal execution state must have a finish time only when terminal");
        }
    }

    private Map<String, NodeExecution> transitionNodes(Transition transition) {
        Map<String, NodeExecution> nodes = new LinkedHashMap<>();
        for (NodeExecution node : transition.nodes()) {
            if (node == null || nodes.putIfAbsent(node.getNodeId(), node) != null) {
                throw new IllegalArgumentException("Execution transition contains duplicate or invalid nodes");
            }
        }
        return nodes;
    }

    private void validateNodeStatuses(Transition transition, Map<String, NodeExecution> nodes) {
        for (Map.Entry<String, NodeExecution> entry : nodes.entrySet()) {
            if (transition.graph().nodes().get(entry.getKey()) != entry.getValue().getStatus()) {
                throw new IllegalArgumentException("Execution graph and node status disagree");
            }
            boolean waiting = entry.getValue().getStatus() == NodeExecutionStatus.WAITING;
            if (waiting != transition.nextAttempts().containsKey(entry.getKey())) {
                throw new IllegalArgumentException("Execution retry timestamp does not match the node status");
            }
        }
    }

    private void persistAttempt(NodeExecutionAttempt attempt) {
        int updated = jdbc.update("""
                UPDATE %s
                SET status = ?, input = CAST(? AS jsonb), output = CAST(? AS jsonb),
                    error = CAST(? AS jsonb), started_at = ?, finished_at = ?
                WHERE id = ? AND node_execution_id = ? AND attempt_number = ?
                """.formatted(attemptTable), attempt.getStatus().name(), writeJson(attempt.getInput()),
                writeJson(attempt.getOutput()), writeJson(attempt.getError()), timestamp(attempt.getStartedAt()),
                timestamp(attempt.getFinishedAt()), attempt.getId(), attempt.getNodeExecutionId(),
                attempt.getAttemptNumber());
        if (updated == 0) {
            jdbc.update("""
                    INSERT INTO %s (id, node_execution_id, attempt_number, status, input, output, error,
                                    started_at, finished_at, created_at)
                    VALUES (?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb), CAST(? AS jsonb), ?, ?, ?)
                    """.formatted(attemptTable), attempt.getId(), attempt.getNodeExecutionId(),
                    attempt.getAttemptNumber(), attempt.getStatus().name(), writeJson(attempt.getInput()),
                    writeJson(attempt.getOutput()), writeJson(attempt.getError()), timestamp(attempt.getStartedAt()),
                    timestamp(attempt.getFinishedAt()), timestamp(attempt.getCreatedAt()));
        }
    }

    private void persistLog(UUID executionId, ExecutionLog log) {
        jdbc.update("""
                INSERT INTO %s (id, execution_id, node_execution_id, attempt_id, level, event_type,
                                message, metadata, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?)
                """.formatted(logTable), log.getId(), executionId, log.getNodeExecutionId(), log.getAttemptId(),
                log.getLevel().name(), log.getEventType(), log.getMessage(), writeJson(log.getMetadata()),
                timestamp(log.getCreatedAt()));
    }

    private Map<String, Object> edgeJsonValues(GraphState graph) {
        Map<String, Object> values = new LinkedHashMap<>();
        graph.edges().forEach((id, state) -> values.put(id, state.name()));
        return values;
    }

    private WorkflowDefinition decodeDefinition(String definitionJson) {
        try {
            return definitionCodec.decode(parseJson(definitionJson));
        } catch (RuntimeException exception) {
            throw new IllegalStateException("Persisted workflow definition could not be recovered");
        }
    }

    private Map<String, Object> definitionObject(String definitionJson) {
        return objectMap(parseJson(definitionJson), "Persisted workflow version is malformed");
    }

    private String triggerNodeType(String triggerType) {
        if (triggerType == null) {
            return null;
        }
        try {
            return "trigger." + ExecutionTriggerType.valueOf(triggerType).name().toLowerCase(java.util.Locale.ROOT);
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    private String triggerRegistrationType(String triggerType) {
        if (triggerType == null) {
            return null;
        }
        try {
            return switch (ExecutionTriggerType.valueOf(triggerType)) {
                case MANUAL -> null;
                case SCHEDULE -> "SCHEDULE";
                case WEBHOOK -> "WEBHOOK";
                case TELEGRAM -> "TELEGRAM";
            };
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    private static boolean isTerminal(ExecutionStatus status) {
        return status == ExecutionStatus.SUCCESS || status == ExecutionStatus.FAILED
                || status == ExecutionStatus.CANCELLED;
    }

    private void validateOwner(String owner) {
        if (owner == null || owner.isBlank() || owner.length() > 128) {
            throw new IllegalArgumentException("Lease owner must be nonblank and at most 128 characters");
        }
    }

    private static long boundedLeaseMillis(Duration duration) {
        if (duration == null || duration.isNegative() || duration.isZero()
                || duration.toMillis() < 1 || duration.toMillis() > MAX_LEASE_MILLIS) {
            throw new IllegalArgumentException("Execution lease duration must be between 1 ms and 24 hours");
        }
        return duration.toMillis();
    }

    private static long boundedNonNegativeMillis(Duration duration, String name) {
        if (duration == null || duration.isNegative() || duration.toMillis() > Integer.MAX_VALUE) {
            throw new IllegalArgumentException(name + " must be nonnegative and bounded");
        }
        return duration.toMillis();
    }

    private JsonNode parseJson(String json) {
        if (json == null) {
            return null;
        }
        try {
            return objectMapper.readTree(json);
        } catch (Exception exception) {
            throw new IllegalStateException("Persisted execution JSON is malformed");
        }
    }

    private Object jsonValue(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (node.isObject()) {
            return objectMap(node, "Persisted execution JSON object is malformed");
        }
        if (node.isArray()) {
            List<Object> values = new ArrayList<>(node.size());
            for (JsonNode child : node) {
                values.add(jsonValue(child));
            }
            return JsonValues.freeze(values);
        }
        if (node.isString()) {
            return node.stringValue();
        }
        if (node.isBoolean()) {
            return node.booleanValue();
        }
        if (node.isNumber()) {
            return node.numberValue();
        }
        throw new IllegalStateException("Persisted execution JSON contains an unsupported value");
    }

    private Map<String, Object> objectMap(JsonNode node, String message) {
        if (node == null || node.isNull()) {
            return new LinkedHashMap<>();
        }
        if (!node.isObject()) {
            throw new IllegalStateException(message);
        }
        Map<String, Object> values = new LinkedHashMap<>();
        for (Map.Entry<String, JsonNode> property : node.properties()) {
            values.put(property.getKey(), jsonValue(property.getValue()));
        }
        return values;
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception exception) {
            throw new IllegalArgumentException("Execution state contains a value that cannot be serialized safely");
        }
    }

    private static Timestamp timestamp(Instant instant) {
        return instant == null ? null : Timestamp.from(instant);
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private static final RowMapper<ClaimRow> CLAIM_ROW_MAPPER = (rs, rowNum) -> new ClaimRow(
            rs.getObject("id", UUID.class), rs.getObject("workflow_id", UUID.class),
            rs.getObject("workflow_version_id", UUID.class), rs.getObject("trigger_id", UUID.class),
            rs.getString("trigger_type"), rs.getString("status"), rs.getString("root_node_id"),
            rs.getLong("lease_token"), rs.getBoolean("lease_active"),
            rs.getObject("version_workflow_id", UUID.class), nullableInteger(rs, "version_number"),
            rs.getString("version_definition"), rs.getString("version_schema_version"),
            rs.getObject("published_by", UUID.class), instant(rs, "version_created_at"));

    private static final RowMapper<SnapshotRow> SNAPSHOT_ROW_MAPPER = (rs, rowNum) -> new SnapshotRow(
            rs.getObject("workflow_id", UUID.class), rs.getObject("workspace_id", UUID.class),
            rs.getObject("workflow_version_id", UUID.class), rs.getObject("trigger_id", UUID.class),
            rs.getString("trigger_type"), rs.getString("root_node_id"), rs.getString("input_json"),
            rs.getString("edge_states_json"), rs.getString("correlation_id"), rs.getString("traceparent"),
            rs.getString("status"), rs.getObject("version_workflow_id", UUID.class),
            nullableInteger(rs, "version_number"), rs.getString("version_definition"),
            rs.getString("version_schema_version"), rs.getObject("published_by", UUID.class),
            instant(rs, "version_created_at"));

    private NodeExecution mapNodeRow(ResultSet rs, int rowNum) throws SQLException {
        return new NodeExecution(rs.getObject("id", UUID.class), rs.getObject("execution_id", UUID.class),
                rs.getString("node_id"), rs.getString("node_type"),
                NodeExecutionStatus.valueOf(rs.getString("status")),
                jsonObject(rs.getString("input_json")), jsonObject(rs.getString("output_json")),
                jsonObject(rs.getString("error_json")), rs.getInt("attempt_count"),
                instant(rs, "started_at"), instant(rs, "finished_at"), instant(rs, "created_at"),
                instant(rs, "next_attempt_at"));
    }

    private NodeExecutionAttempt mapAttemptRow(ResultSet rs, int rowNum) throws SQLException {
        return new NodeExecutionAttempt(rs.getObject("id", UUID.class),
                rs.getObject("node_execution_id", UUID.class), rs.getInt("attempt_number"),
                AttemptStatus.valueOf(rs.getString("status")), jsonObject(rs.getString("input_json")),
                jsonObject(rs.getString("output_json")), jsonObject(rs.getString("error_json")),
                instant(rs, "started_at"), instant(rs, "finished_at"), instant(rs, "created_at"));
    }

    private Map<String, Object> jsonObject(String json) {
        return json == null ? null : objectMap(parseJson(json), "Persisted execution JSON object is malformed");
    }

    private static Integer nullableInteger(ResultSet rs, String column) throws SQLException {
        int value = rs.getInt(column);
        return rs.wasNull() ? null : value;
    }

    private record ClaimRow(UUID id, UUID workflowId, UUID versionId, UUID triggerId, String triggerType,
                            String status, String rootNodeId, long leaseToken, boolean leaseActive,
                            UUID versionWorkflowId, Integer versionNumber, String versionDefinition,
                            String versionSchemaVersion, UUID publishedBy, Instant versionCreatedAt) {
    }

    private record SnapshotRow(UUID workflowId, UUID workspaceId, UUID versionId, UUID triggerId,
                               String triggerType, String rootNodeId, String inputJson, String edgeStatesJson,
                               String correlationId, String traceparent, String status, UUID versionWorkflowId,
                               Integer versionNumber, String versionDefinition, String versionSchemaVersion,
                               UUID publishedBy, Instant versionCreatedAt) {
    }

    private record StoredNode(UUID id, String nodeId) {
    }
}
