package com.weav.workflow.infrastructure.files;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/** Metadata rows of {@code workflow_files}. Plain JDBC: the table has no behavior beyond these statements. */
public class WorkflowFileRepository {

    private static final Pattern SQL_IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");
    private static final String COLUMNS = "id, workspace_id, object_key, filename, mime_type, size_bytes, expires_at";
    private static final RowMapper<Row> MAPPER = (rs, i) -> new Row(rs.getObject("id", UUID.class),
            rs.getObject("workspace_id", UUID.class), rs.getString("object_key"), rs.getString("filename"),
            rs.getString("mime_type"), rs.getLong("size_bytes"), rs.getTimestamp("expires_at").toInstant());

    record Row(UUID id, UUID workspaceId, String objectKey, String filename, String mimeType, long sizeBytes,
               Instant expiresAt) {
    }

    private final JdbcTemplate jdbc;
    private final String table;

    public WorkflowFileRepository(JdbcTemplate jdbc, String schema) {
        if (schema == null || !SQL_IDENTIFIER.matcher(schema).matches()) {
            throw new IllegalArgumentException("The configured workflow schema name is invalid");
        }
        this.jdbc = jdbc;
        this.table = "\"" + schema + "\".workflow_files";
    }

    void insert(Row row, UUID executionId, Instant createdAt) {
        jdbc.update("INSERT INTO " + table + " (id, workspace_id, execution_id, object_key, filename, mime_type, "
                        + "size_bytes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                row.id(), row.workspaceId(), executionId, row.objectKey(), row.filename(), row.mimeType(),
                row.sizeBytes(), Timestamp.from(createdAt), Timestamp.from(row.expiresAt()));
    }

    Optional<Row> find(UUID id) {
        return jdbc.query("SELECT " + COLUMNS + " FROM " + table + " WHERE id = ?", MAPPER, id).stream().findFirst();
    }

    /** Expired rows strictly after the {@code (expires_at, id)} cursor, oldest first. */
    List<Row> findExpired(Instant now, Instant afterExpiresAt, UUID afterId, int limit) {
        return jdbc.query("SELECT " + COLUMNS + " FROM " + table
                        + " WHERE expires_at <= ? AND (expires_at, id) > (?, ?) ORDER BY expires_at, id LIMIT ?",
                MAPPER, Timestamp.from(now), Timestamp.from(afterExpiresAt), afterId, limit);
    }

    void delete(UUID id) {
        jdbc.update("DELETE FROM " + table + " WHERE id = ?", id);
    }
}
