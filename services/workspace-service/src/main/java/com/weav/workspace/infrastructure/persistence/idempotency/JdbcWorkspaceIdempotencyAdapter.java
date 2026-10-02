package com.weav.workspace.infrastructure.persistence.idempotency;

import com.weav.workspace.application.port.out.WorkspaceIdempotencyPort;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

@Repository
public class JdbcWorkspaceIdempotencyAdapter implements WorkspaceIdempotencyPort {
    private static final Pattern SAFE_SCHEMA = Pattern.compile("[A-Za-z_][A-Za-z0-9_]{0,62}");

    private final JdbcTemplate jdbcTemplate;
    private final String table;

    public JdbcWorkspaceIdempotencyAdapter(
            JdbcTemplate jdbcTemplate,
            @Value("${DB_SCHEMA:workspace}") String schema) {
        this.jdbcTemplate = Objects.requireNonNull(jdbcTemplate);
        if (!SAFE_SCHEMA.matcher(schema).matches()) {
            throw new IllegalArgumentException("DB_SCHEMA must be a simple PostgreSQL schema identifier");
        }
        this.table = '"' + schema + '"' + ".workspace_idempotency";
    }

    @Override
    public Optional<Entry> find(UUID userId, String key) {
        return jdbcTemplate.query("select workspace_id, request_hash from " + table
                        + " where user_id = ? and idem_key = ?",
                (rs, row) -> new Entry(rs.getObject(1, UUID.class), rs.getString(2)),
                userId, key).stream().findFirst();
    }

    @Override
    public boolean claim(UUID userId, String key, UUID workspaceId, String requestHash) {
        return jdbcTemplate.update("insert into " + table
                        + " (user_id, idem_key, workspace_id, request_hash) values (?, ?, ?, ?) "
                        + "on conflict (user_id, idem_key) do nothing",
                userId, key, workspaceId, requestHash) == 1;
    }
}
