package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowSummary;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowJpaEntity;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import com.weav.workflow.infrastructure.persistence.mapper.WorkflowPersistenceMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.persistence.PersistenceContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

@Repository
public class WorkflowRepositoryAdapter implements WorkflowRepository {

    private static final java.util.regex.Pattern SQL_IDENTIFIER =
            java.util.regex.Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");

    private static final String WORKSPACE_QUERY = "select workflow from WorkflowJpaEntity workflow "
            + "where workflow.workspaceId = :workspaceId and workflow.deletedAt is null";

    @PersistenceContext
    private EntityManager entityManager;

    private final WorkflowPersistenceMapper mapper;
    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final String pageSql;

    public WorkflowRepositoryAdapter(
            WorkflowPersistenceMapper mapper,
            JdbcTemplate jdbc,
            ObjectMapper objectMapper,
            @Value("${spring.jpa.properties.hibernate.default_schema:workflow}") String schema) {
        this.mapper = Objects.requireNonNull(mapper, "mapper must not be null");
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        if (schema == null || !SQL_IDENTIFIER.matcher(schema).matches()) {
            throw new IllegalArgumentException("schema must be a simple SQL identifier");
        }
        // Node types are extracted in the database so the (large) draft definition and editor state never travel.
        this.pageSql = """
                SELECT w.id, w.name, w.description, w.status, w.schema_version, w.current_version_id,
                       w.created_at, w.updated_at, w.published_at,
                       CASE WHEN jsonb_typeof(w.draft_definition -> 'nodes') = 'array'
                            THEN jsonb_path_query_array(w.draft_definition, '$.nodes[*].type')::text
                            ELSE '[]' END AS node_types
                FROM %s.workflows w
                WHERE w.workspace_id = ? AND w.deleted_at IS NULL
                ORDER BY w.created_at DESC, w.id DESC
                LIMIT ? OFFSET ?
                """.formatted(schema);
    }

    @Override
    @Transactional
    public Workflow save(Workflow workflow) {
        Objects.requireNonNull(workflow, "workflow must not be null");
        WorkflowJpaEntity persisted = entityManager.find(WorkflowJpaEntity.class, workflow.getId());
        if (persisted == null) {
            entityManager.persist(mapper.toEntity(workflow));
            return workflow;
        }
        if (!persisted.getWorkspaceId().equals(workflow.getWorkspaceId())
                || !persisted.getCreatedBy().equals(workflow.getCreatedBy())) {
            throw new IllegalArgumentException("Workflow identity cannot be reassigned");
        }
        mapper.updateEntity(persisted, workflow);
        return workflow;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Workflow> findById(UUID id) {
        Objects.requireNonNull(id, "id must not be null");
        List<WorkflowJpaEntity> matches = entityManager.createQuery(
                        "select workflow from WorkflowJpaEntity workflow "
                                + "where workflow.id = :workflowId and workflow.deletedAt is null",
                        WorkflowJpaEntity.class)
                .setParameter("workflowId", id)
                .setMaxResults(1)
                .getResultList();
        return matches.stream().findFirst().map(mapper::toDomain);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Workflow> findByWorkspaceAndId(UUID workspaceId, UUID workflowId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(workflowId, "workflowId must not be null");
        List<WorkflowJpaEntity> matches = entityManager.createQuery(
                        WORKSPACE_QUERY + " and workflow.id = :workflowId", WorkflowJpaEntity.class)
                .setParameter("workspaceId", workspaceId)
                .setParameter("workflowId", workflowId)
                .setMaxResults(1)
                .getResultList();
        return matches.stream().findFirst().map(mapper::toDomain);
    }

    @Override
    @Transactional(readOnly = true)
    public List<WorkflowSummary> findPage(UUID workspaceId, int page, int size) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        int offset = checkedOffset(page, size);
        return jdbc.query(pageSql, this::summary, workspaceId, size, offset);
    }

    private WorkflowSummary summary(ResultSet rs, int rowNum) throws SQLException {
        List<String> nodeTypes = new ArrayList<>();
        for (JsonNode type : objectMapper.readTree(rs.getString("node_types"))) {
            if (type.isString()) {
                nodeTypes.add(type.stringValue());
            }
        }
        return new WorkflowSummary(
                rs.getObject("id", UUID.class),
                rs.getString("name"),
                rs.getString("description"),
                WorkflowStatus.valueOf(rs.getString("status")),
                rs.getString("schema_version"),
                rs.getObject("current_version_id", UUID.class),
                instant(rs, "created_at"),
                instant(rs, "updated_at"),
                instant(rs, "published_at"),
                nodeTypes);
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    @Override
    @Transactional(readOnly = true)
    public long countByWorkspace(UUID workspaceId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        return entityManager.createQuery(
                        "select count(workflow) from WorkflowJpaEntity workflow "
                                + "where workflow.workspaceId = :workspaceId and workflow.deletedAt is null",
                        Long.class)
                .setParameter("workspaceId", workspaceId)
                .getSingleResult();
    }

    @Override
    @Transactional
    public Optional<Workflow> lockByWorkspaceAndId(UUID workspaceId, UUID workflowId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(workflowId, "workflowId must not be null");
        List<WorkflowJpaEntity> matches = entityManager.createQuery(
                        WORKSPACE_QUERY + " and workflow.id = :workflowId", WorkflowJpaEntity.class)
                .setParameter("workspaceId", workspaceId)
                .setParameter("workflowId", workflowId)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .setMaxResults(1)
                .getResultList();
        if (matches.isEmpty()) {
            return Optional.empty();
        }
        WorkflowJpaEntity locked = matches.getFirst();
        entityManager.refresh(locked, LockModeType.PESSIMISTIC_WRITE);
        return Optional.of(mapper.toDomain(locked));
    }

    @Override
    @Transactional
    public Optional<Workflow> lockById(UUID workflowId, java.time.Duration lockTimeout) {
        Objects.requireNonNull(lockTimeout, "lockTimeout must not be null");
        // WF-14: transaction-scoped (is_local = true), so it also bounds the admission locks that follow.
        entityManager.createNativeQuery("select set_config('lock_timeout', ?1, true)")
                .setParameter(1, lockTimeout.toMillis() + "ms")
                .getSingleResult();
        return lockById(workflowId);
    }

    @Override
    @Transactional
    public Optional<Workflow> lockById(UUID workflowId) {
        Objects.requireNonNull(workflowId, "workflowId must not be null");
        List<WorkflowJpaEntity> matches = entityManager.createQuery(
                        "select workflow from WorkflowJpaEntity workflow "
                                + "where workflow.id = :workflowId and workflow.deletedAt is null",
                        WorkflowJpaEntity.class)
                .setParameter("workflowId", workflowId)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .setMaxResults(1)
                .getResultList();
        if (matches.isEmpty()) {
            return Optional.empty();
        }
        WorkflowJpaEntity locked = matches.getFirst();
        entityManager.refresh(locked, LockModeType.PESSIMISTIC_WRITE);
        return Optional.of(mapper.toDomain(locked));
    }

    @Override
    @Transactional(readOnly = true)
    public List<UUID> findIdsByWorkspaceAndStatus(
            UUID workspaceId, com.weav.workflow.domain.valueobject.WorkflowStatus status) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(status, "status must not be null");
        return entityManager.createQuery(
                        "select workflow.id from WorkflowJpaEntity workflow "
                                + "where workflow.workspaceId = :workspaceId and workflow.deletedAt is null "
                                + "and workflow.status = :status order by workflow.createdAt, workflow.id",
                        UUID.class)
                .setParameter("workspaceId", workspaceId)
                .setParameter("status", status)
                .getResultList();
    }

    private int checkedOffset(int page, int size) {
        if (page < 0 || size < 1 || size > 100) {
            throw new IllegalArgumentException("Workflow page bounds are invalid");
        }
        long offset = (long) page * size;
        if (offset > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("Workflow page offset is out of range");
        }
        return (int) offset;
    }
}
