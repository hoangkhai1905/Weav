package com.weav.identity.infrastructure.persistence.notification;

import com.weav.identity.application.notification.IdentityNotificationEvent;
import com.weav.identity.application.notification.NotificationOutboxWriteException;
import com.weav.identity.application.port.out.IdentityNotificationOutboxPort;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.ObjectMapper;

import java.util.Objects;
import java.util.regex.Pattern;

@Repository
public class JdbcIdentityNotificationOutboxAdapter implements IdentityNotificationOutboxPort {
    private static final Pattern SAFE_SCHEMA = Pattern.compile("[A-Za-z_][A-Za-z0-9_]{0,62}");

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final String qualifiedTable;

    public JdbcIdentityNotificationOutboxAdapter(
            JdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper,
            @Value("${DB_SCHEMA:identity}") String schema) {
        this.jdbcTemplate = Objects.requireNonNull(jdbcTemplate);
        this.objectMapper = Objects.requireNonNull(objectMapper);
        if (!SAFE_SCHEMA.matcher(schema).matches()) {
            throw new IllegalArgumentException("DB_SCHEMA must be a simple PostgreSQL schema identifier");
        }
        this.qualifiedTable = '"' + schema + '"' + ".notification_outbox";
    }

    @Override
    public void append(IdentityNotificationEvent event) {
        Objects.requireNonNull(event);
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("Identity notification append requires the caller transaction");
        }
        try {
            String payload = objectMapper.writeValueAsString(event);
            int inserted = jdbcTemplate.update("insert into " + qualifiedTable
                            + " (event_id, event_type, payload, created_at, attempts, next_attempt_at) "
                            + "values (?, ?, cast(? as jsonb), current_timestamp, 0, current_timestamp)",
                    event.eventId(), event.eventType(), payload);
            if (inserted != 1) {
                throw new IllegalStateException("Identity notification outbox row was not inserted");
            }
        } catch (Exception exception) {
            throw new NotificationOutboxWriteException();
        }
    }
}
