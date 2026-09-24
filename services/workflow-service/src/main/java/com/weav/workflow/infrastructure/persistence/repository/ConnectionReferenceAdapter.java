package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.application.port.out.ConnectionReferencePort;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** PostgreSQL projection kept in the authoring transaction that changes its source snapshot. */
@Repository
public class ConnectionReferenceAdapter implements ConnectionReferencePort {

    private final JdbcTemplate jdbcTemplate;
    private final String referencesTable;
    private final String workflowsTable;
    private final String versionsTable;
    private final String draftInsert;
    private final String versionInsert;

    public ConnectionReferenceAdapter(
            JdbcTemplate jdbcTemplate,
            @Value("${spring.jpa.properties.hibernate.default_schema:workflow}") String schema) {
        this.jdbcTemplate = Objects.requireNonNull(jdbcTemplate, "jdbcTemplate must not be null");
        Objects.requireNonNull(schema, "schema must not be null");
        if (schema.isBlank()) {
            throw new IllegalArgumentException("schema must not be blank");
        }
        String qualifiedSchema = "\"" + schema.replace("\"", "\"\"") + "\".";
        this.referencesTable = qualifiedSchema + "workflow_connection_references";
        this.workflowsTable = qualifiedSchema + "workflows";
        this.versionsTable = qualifiedSchema + "workflow_versions";
        this.draftInsert = "insert into " + referencesTable
                + " (workflow_id, version_id, connection_id) values (?, null, ?) "
                + "on conflict (workflow_id, connection_id) where version_id is null do nothing";
        this.versionInsert = "insert into " + referencesTable
                + " (workflow_id, version_id, connection_id) values (?, ?, ?) "
                + "on conflict (version_id, connection_id) where version_id is not null do nothing";
    }

    @Override
    @Transactional
    public void replaceDraft(UUID workflowId, Set<UUID> connections) {
        Objects.requireNonNull(workflowId, "workflowId must not be null");
        Set<UUID> safeConnections = Set.copyOf(Objects.requireNonNull(connections, "connections must not be null"));

        jdbcTemplate.update("delete from " + referencesTable + " "
                        + "where workflow_id = ? and version_id is null",
                workflowId);
        for (UUID connectionId : safeConnections) {
            jdbcTemplate.update(draftInsert, workflowId, connectionId);
        }
    }

    @Override
    @Transactional
    public void appendVersion(UUID workflowId, UUID versionId, Set<UUID> connections) {
        Objects.requireNonNull(workflowId, "workflowId must not be null");
        Objects.requireNonNull(versionId, "versionId must not be null");
        Set<UUID> safeConnections = Set.copyOf(Objects.requireNonNull(connections, "connections must not be null"));
        if (safeConnections.isEmpty()) {
            return;
        }
        Boolean belongsToWorkflow = jdbcTemplate.queryForObject(
                "select exists (select 1 from " + versionsTable + " where id = ? and workflow_id = ?)",
                Boolean.class,
                versionId,
                workflowId);
        if (!Boolean.TRUE.equals(belongsToWorkflow)) {
            throw new IllegalArgumentException("versionId must belong to workflowId");
        }

        for (UUID connectionId : safeConnections) {
            jdbcTemplate.update(versionInsert, workflowId, versionId, connectionId);
        }
    }

    @Override
    @Transactional(readOnly = true)
    public boolean inUse(UUID workspaceId, UUID connectionId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        Boolean inUse = jdbcTemplate.queryForObject(
                "select exists ("
                        + "select 1 from " + referencesTable + " r "
                        + "join " + workflowsTable + " w on w.id = r.workflow_id "
                        + "where w.workspace_id = ? and r.connection_id = ? "
                        + "and (r.version_id is not null or w.deleted_at is null)"
                        + ")",
                Boolean.class,
                workspaceId,
                connectionId);
        return Boolean.TRUE.equals(inUse);
    }
}
