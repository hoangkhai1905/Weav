package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.application.port.out.TemplateStore;
import com.weav.workflow.domain.template.ShareCode;
import com.weav.workflow.domain.valueobject.TemplateVisibility;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.security.SecureRandom;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.random.RandomGenerator;
import java.util.regex.Pattern;

/** Shared workflow templates (workflow schema only). */
@Repository
public class TemplateAdapter implements TemplateStore {
    private static final Pattern SQL_IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");
    private static final TypeReference<Map<String, Object>> JSON_OBJECT = new TypeReference<>() { };
    private static final int MAX_CODE_ATTEMPTS = 5;
    private static final String COLUMNS = "id, owner_id, workspace_id, source_workflow_id, name, description, "
            + "author_name, definition, editor_state, node_types, visibility, share_code, usage_count, "
            + "created_at, updated_at";

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final RandomGenerator random;
    private final String table;
    private final RowMapper<Template> mapper = this::template;

    @Autowired
    public TemplateAdapter(
            JdbcTemplate jdbc,
            ObjectMapper json,
            @Value("${spring.jpa.properties.hibernate.default_schema:workflow}") String schema) {
        this(jdbc, json, schema, new SecureRandom());
    }

    /** The random source is injectable so tests can force a share-code clash. */
    public TemplateAdapter(JdbcTemplate jdbc, ObjectMapper json, String schema, RandomGenerator random) {
        this.random = Objects.requireNonNull(random, "random must not be null");
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.json = Objects.requireNonNull(json, "json must not be null");
        if (schema == null || !SQL_IDENTIFIER.matcher(schema).matches()) {
            throw new IllegalArgumentException("schema must be a simple SQL identifier");
        }
        this.table = schema + ".workflow_templates";
    }

    /** A clash on the random code redraws it (ON CONFLICT on share_code only); other violations still throw. */
    @Override
    public Template insert(Template t) {
        for (int attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
            String code = ShareCode.generate(random);
            int inserted = jdbc.update(connection -> {
                var statement = connection.prepareStatement("""
                            INSERT INTO %s (id, owner_id, workspace_id, source_workflow_id, name, description,
                                            author_name, definition, editor_state, node_types, visibility,
                                            share_code, usage_count, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT (share_code) DO NOTHING
                            """.formatted(table));
                    statement.setObject(1, t.id());
                    statement.setObject(2, t.ownerId());
                    statement.setObject(3, t.workspaceId());
                    statement.setObject(4, t.sourceWorkflowId());
                    statement.setString(5, t.name());
                    statement.setString(6, t.description());
                    statement.setString(7, t.authorName());
                    statement.setString(8, write(t.definition()));
                    statement.setString(9, t.editorState() == null ? null : write(t.editorState()));
                    statement.setArray(10, connection.createArrayOf("text", t.nodeTypes().toArray()));
                    statement.setString(11, t.visibility().name());
                    statement.setString(12, code);
                    statement.setInt(13, t.usageCount());
                    statement.setTimestamp(14, Timestamp.from(t.createdAt()));
                    statement.setTimestamp(15, Timestamp.from(t.updatedAt()));
                    return statement;
            });
            if (inserted == 1) {
                return findLive(t.id()).orElseThrow();
            }
        }
        throw new IllegalStateException("Could not allocate a unique template share code");
    }

    @Override
    @Transactional
    public Template update(Template t) {
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("""
                    UPDATE %s SET name = ?, description = ?, author_name = ?, definition = ?::jsonb,
                                  editor_state = ?::jsonb, node_types = ?, visibility = ?, updated_at = ?
                    WHERE id = ? AND deleted_at IS NULL
                    """.formatted(table));
            statement.setString(1, t.name());
            statement.setString(2, t.description());
            statement.setString(3, t.authorName());
            statement.setString(4, write(t.definition()));
            statement.setString(5, t.editorState() == null ? null : write(t.editorState()));
            statement.setArray(6, connection.createArrayOf("text", t.nodeTypes().toArray()));
            statement.setString(7, t.visibility().name());
            statement.setTimestamp(8, Timestamp.from(t.updatedAt()));
            statement.setObject(9, t.id());
            return statement;
        });
        return findLive(t.id()).orElseThrow();
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Template> findLive(UUID id) {
        return jdbc.query("SELECT %s FROM %s WHERE id = ? AND deleted_at IS NULL".formatted(COLUMNS, table),
                mapper, id).stream().findFirst();
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Template> findLiveByCode(String code) {
        return jdbc.query("SELECT %s FROM %s WHERE share_code = ? AND deleted_at IS NULL".formatted(COLUMNS, table),
                mapper, code).stream().findFirst();
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Template> findLiveBySourceWorkflow(UUID workflowId) {
        return jdbc.query("SELECT %s FROM %s WHERE source_workflow_id = ? AND deleted_at IS NULL"
                .formatted(COLUMNS, table), mapper, workflowId).stream().findFirst();
    }

    @Override
    @Transactional(readOnly = true)
    public int countLiveByOwner(UUID ownerId) {
        return jdbc.queryForObject("SELECT count(*) FROM %s WHERE owner_id = ? AND deleted_at IS NULL"
                .formatted(table), Integer.class, ownerId);
    }

    @Override
    @Transactional(readOnly = true)
    public Page list(Scope scope, UUID callerId, UUID workspaceId, String query, int page, int size) {
        StringBuilder where = new StringBuilder("deleted_at IS NULL");
        List<Object> args = new ArrayList<>();
        String order = "created_at DESC, id";
        switch (scope) {
            case PUBLIC -> {
                where.append(" AND visibility = 'PUBLIC'");
                order = "usage_count DESC, created_at DESC, id";
            }
            case WORKSPACE -> {
                where.append(" AND visibility = 'PRIVATE' AND workspace_id = ?");
                args.add(workspaceId);
            }
            case MINE -> {
                where.append(" AND owner_id = ?");
                args.add(callerId);
            }
        }
        if (query != null && !query.isBlank()) {
            String pattern = "%" + query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
            where.append(" AND (name ILIKE ? ESCAPE '\\' OR description ILIKE ? ESCAPE '\\')");
            args.add(pattern);
            args.add(pattern);
        }
        long total = jdbc.queryForObject("SELECT count(*) FROM %s WHERE %s".formatted(table, where),
                Long.class, args.toArray());
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(size);
        pageArgs.add((long) page * size);
        List<Template> items = jdbc.query("SELECT %s FROM %s WHERE %s ORDER BY %s LIMIT ? OFFSET ?"
                .formatted(COLUMNS, table, where, order), mapper, pageArgs.toArray());
        return new Page(items, page, size, total);
    }

    @Override
    @Transactional
    public void softDelete(UUID id, Instant at) {
        jdbc.update("UPDATE %s SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL".formatted(table),
                Timestamp.from(at), Timestamp.from(at), id);
    }

    @Override
    @Transactional
    public boolean incrementUsage(UUID id) {
        return jdbc.update("UPDATE %s SET usage_count = usage_count + 1 WHERE id = ? AND deleted_at IS NULL"
                .formatted(table), id) == 1;
    }

    private Template template(ResultSet rs, int row) throws SQLException {
        String editorState = rs.getString("editor_state");
        Array nodeTypes = rs.getArray("node_types");
        return new Template(
                rs.getObject("id", UUID.class), rs.getObject("owner_id", UUID.class),
                rs.getObject("workspace_id", UUID.class), rs.getObject("source_workflow_id", UUID.class),
                rs.getString("name"), rs.getString("description"), rs.getString("author_name"),
                read(rs.getString("definition")), editorState == null ? null : read(editorState),
                List.copyOf(Arrays.asList((String[]) nodeTypes.getArray())),
                TemplateVisibility.valueOf(rs.getString("visibility")), rs.getString("share_code"),
                rs.getInt("usage_count"), rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }

    private String write(Map<String, Object> value) {
        return json.writeValueAsString(value);
    }

    private Map<String, Object> read(String value) {
        return json.readValue(value, JSON_OBJECT);
    }
}
