package com.weav.workspace.infrastructure.persistence.notification;

import com.weav.workspace.application.notification.WorkspaceNotificationEvent;
import com.weav.workspace.application.notification.NotificationOutboxWriteException;
import com.weav.workspace.application.port.out.NotificationOutboxPort;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.ObjectMapper;

import java.util.Objects;
import java.util.regex.Pattern;

@Repository
public class JdbcNotificationOutboxAdapter implements NotificationOutboxPort {
    private static final Pattern SAFE_SCHEMA = Pattern.compile("[A-Za-z_][A-Za-z0-9_]{0,62}");

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final String qualifiedTable;

    public JdbcNotificationOutboxAdapter(
            JdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper,
            @Value("${DB_SCHEMA:workspace}") String schema) {
        this.jdbcTemplate = Objects.requireNonNull(jdbcTemplate);
        this.objectMapper = Objects.requireNonNull(objectMapper);
        if (!SAFE_SCHEMA.matcher(schema).matches()) {
            throw new IllegalArgumentException("DB_SCHEMA must be a simple PostgreSQL schema identifier");
        }
        this.qualifiedTable = '"' + schema + '"' + ".notification_outbox";
    }

    @Override
    public void append(WorkspaceNotificationEvent event) {
        Objects.requireNonNull(event);
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("Notification outbox append requires the caller transaction");
        }
        try {
            String payload = objectMapper.writeValueAsString(event);
            jdbcTemplate.update("insert into " + qualifiedTable
                            + " (event_id, event_type, payload, created_at, attempts, next_attempt_at) "
                            + "values (?, ?, cast(? as jsonb), current_timestamp, 0, current_timestamp)",
                    event.eventId(), event.eventType(), payload);
        } catch (Exception exception) {
            throw new NotificationOutboxWriteException();
        }
    }
}
