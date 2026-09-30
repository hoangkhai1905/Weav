package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.application.notification.WorkflowNotificationEvent;
import com.weav.workflow.application.port.out.WorkflowNotificationOutboxStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/** Owns only Workflow-to-Notification event intent and its independently leased delivery state. */
@Repository
public class WorkflowNotificationOutboxAdapter implements WorkflowNotificationOutboxStore {
    private static final Pattern SQL_IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");
    private static final int MAX_LEASE_MILLIS = 300_000;

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final String table;

    public WorkflowNotificationOutboxAdapter(
            JdbcTemplate jdbc,
            ObjectMapper objectMapper,
            @Value("${spring.jpa.properties.hibernate.default_schema:workflow}") String schema) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        if (schema == null || !SQL_IDENTIFIER.matcher(schema).matches()) {
            throw new IllegalArgumentException("The configured workflow schema name is invalid");
        }
        table = "\"" + schema + "\".notification_outbox";
    }

    @Override
    @Transactional
    public void record(WorkflowNotificationEvent event) {
        Objects.requireNonNull(event, "event must not be null");
        UUID eventId = UUID.randomUUID();
        String payload = event.recipientUserId() == null ? null : envelope(eventId, event);
        String status = payload == null ? "SKIPPED" : "PENDING";
        String reason = payload == null ? "MISSING_CANDIDATE_USER" : null;
        jdbc.update("""
                INSERT INTO %s (event_id, event_type, occurred_at, workspace_id, actor_user_id,
                                recipient_user_id, entity_kind, entity_id, requires_monitor_access,
                                payload, status, last_reason_code)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?)
                """.formatted(table), eventId, event.eventType(), timestamp(event.occurredAt()),
                event.workspaceId(), event.actorUserId(), event.recipientUserId(), event.entityKind(),
                event.entityId(), event.requiresMonitorAccess(), payload, status, reason);
    }

    @Override
    @Transactional
    public List<ClaimedEvent> claim(int batchSize, Duration leaseDuration) {
        if (batchSize < 1 || batchSize > 1_000) {
            throw new IllegalArgumentException("Notification batch size must be between one and one thousand");
        }
        long leaseMillis = boundedLeaseMillis(leaseDuration);
        UUID token = UUID.randomUUID();
        RowMapper<ClaimedEvent> mapper = (rs, rowNum) -> new ClaimedEvent(
                rs.getObject("event_id", UUID.class), rs.getString("event_type"),
                rs.getObject("workspace_id", UUID.class), rs.getObject("recipient_user_id", UUID.class),
                rs.getBoolean("requires_monitor_access"), rs.getString("payload"), token,
                rs.getInt("retry_count"));
        return jdbc.query("""
                WITH candidates AS (
                    SELECT sequence_id FROM %s
                    WHERE (status = 'PENDING' AND next_attempt_at <= CURRENT_TIMESTAMP)
                       OR (status = 'CLAIMED' AND lease_until <= CURRENT_TIMESTAMP)
                    ORDER BY sequence_id
                    FOR UPDATE SKIP LOCKED
                    LIMIT ?
                )
                UPDATE %s event
                SET status = 'CLAIMED', claim_token = ?,
                    lease_until = CURRENT_TIMESTAMP + (? * INTERVAL '1 millisecond'),
                    updated_at = CURRENT_TIMESTAMP
                FROM candidates
                WHERE event.sequence_id = candidates.sequence_id
                RETURNING event.event_id, event.event_type, event.workspace_id, event.recipient_user_id,
                          event.requires_monitor_access, event.payload::text AS payload, event.retry_count
                """.formatted(table, table), mapper, batchSize, token, leaseMillis);
    }

    @Override
    @Transactional
    public boolean renewClaim(UUID eventId, UUID claimToken, Duration leaseDuration) {
        long leaseMillis = boundedLeaseMillis(leaseDuration);
        return jdbc.update("""
                UPDATE %s SET lease_until = CURRENT_TIMESTAMP + (? * INTERVAL '1 millisecond'),
                              updated_at = CURRENT_TIMESTAMP
                WHERE event_id = ? AND status = 'CLAIMED' AND claim_token = ?
                  AND lease_until > CURRENT_TIMESTAMP
                """.formatted(table), leaseMillis, eventId, claimToken) == 1;
    }

    @Override
    @Transactional
    public boolean markPublished(UUID eventId, UUID claimToken, Instant at) {
        return jdbc.update("""
                UPDATE %s SET status = 'PUBLISHED', claim_token = NULL, lease_until = NULL,
                              published_at = ?, updated_at = ?, last_reason_code = NULL
                WHERE event_id = ? AND status = 'CLAIMED' AND claim_token = ?
                  AND lease_until > CURRENT_TIMESTAMP
                """.formatted(table), timestamp(at), timestamp(at), eventId, claimToken) == 1;
    }

    @Override
    @Transactional
    public boolean markSkipped(UUID eventId, UUID claimToken, String reasonCode, Instant at) {
        requireReasonCode(reasonCode);
        return jdbc.update("""
                UPDATE %s SET status = 'SKIPPED', claim_token = NULL, lease_until = NULL,
                              last_reason_code = ?, updated_at = ?
                WHERE event_id = ? AND status = 'CLAIMED' AND claim_token = ?
                  AND lease_until > CURRENT_TIMESTAMP
                """.formatted(table), reasonCode, timestamp(at), eventId, claimToken) == 1;
    }

    @Override
    @Transactional
    public boolean scheduleRetry(UUID eventId, UUID claimToken, String reasonCode,
                                 Instant nextAttemptAt, Instant at) {
        requireReasonCode(reasonCode);
        return jdbc.update("""
                UPDATE %s SET status = 'PENDING', claim_token = NULL, lease_until = NULL,
                              retry_count = retry_count + 1, next_attempt_at = ?,
                              last_reason_code = ?, updated_at = ?
                WHERE event_id = ? AND status = 'CLAIMED' AND claim_token = ?
                  AND lease_until > CURRENT_TIMESTAMP
                """.formatted(table), timestamp(nextAttemptAt), reasonCode, timestamp(at), eventId, claimToken) == 1;
    }

    private String envelope(UUID eventId, WorkflowNotificationEvent event) {
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("schemaVersion", 2);
        envelope.put("eventId", eventId.toString());
        envelope.put("eventType", event.eventType());
        envelope.put("occurredAt", OffsetDateTime.ofInstant(event.occurredAt(), ZoneOffset.UTC).toString());
        envelope.put("producer", "workflow-service");
        envelope.put("actorUserId", event.actorUserId() == null ? null : event.actorUserId().toString());
        envelope.put("recipientUserIds", List.of(event.recipientUserId().toString()));
        envelope.put("workspaceId", event.workspaceId().toString());
        envelope.put("entity", Map.of("kind", event.entityKind(), "id", event.entityId().toString()));
        envelope.put("data", event.data());
        try {
            return objectMapper.writeValueAsString(envelope);
        } catch (Exception exception) {
            throw new IllegalStateException("Workflow notification envelope serialization failed", exception);
        }
    }

    private long boundedLeaseMillis(Duration leaseDuration) {
        Objects.requireNonNull(leaseDuration, "leaseDuration must not be null");
        long millis;
        try {
            millis = leaseDuration.toMillis();
        } catch (ArithmeticException exception) {
            throw new IllegalArgumentException("Notification lease duration is out of bounds", exception);
        }
        if (millis < 1 || millis > MAX_LEASE_MILLIS) {
            throw new IllegalArgumentException("Notification lease duration must be at most five minutes");
        }
        return millis;
    }

    private void requireReasonCode(String reasonCode) {
        if (reasonCode == null || !reasonCode.matches("[A-Z][A-Z0-9_]{0,63}")) {
            throw new IllegalArgumentException("Notification failure reason must be a safe code");
        }
    }

    private java.sql.Timestamp timestamp(Instant value) {
        return value == null ? null : java.sql.Timestamp.from(value);
    }
}
