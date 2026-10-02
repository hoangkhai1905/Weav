package com.weav.identity.infrastructure.storage;

import com.weav.identity.application.port.out.AvatarCleanupQueue;
import com.weav.identity.application.port.out.AvatarStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * ID-7: durable avatar cleanup. {@link #enqueue} inserts into avatar_cleanup and joins the caller's transaction,
 * so the row commits or rolls back together with the avatar-key swap. {@link #reconcileNow} claims due rows
 * (FOR UPDATE SKIP LOCKED, leased by bumping next_attempt_at), deletes the object with no transaction open,
 * then removes the row; failures back off and give up (row kept, ERROR logged) after {@link #MAX_ATTEMPTS}.
 */
@Component
public final class AvatarCleanupReconciler implements AvatarCleanupQueue {

    static final int MAX_ATTEMPTS = 10;
    private static final Logger log = LoggerFactory.getLogger(AvatarCleanupReconciler.class);
    private static final Pattern SAFE_SCHEMA = Pattern.compile("[A-Za-z_][A-Za-z0-9_]{0,62}");
    private static final int BATCH_SIZE = 20;
    private static final long LEASE_SECONDS = 300;
    private static final long MAX_BACKOFF_SECONDS = 600;

    private final AvatarStorage storage;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final String table;

    public AvatarCleanupReconciler(
            AvatarStorage storage,
            JdbcTemplate jdbc,
            PlatformTransactionManager transactionManager,
            @Value("${DB_SCHEMA:identity}") String schema
    ) {
        this.storage = Objects.requireNonNull(storage);
        this.jdbc = Objects.requireNonNull(jdbc);
        this.tx = new TransactionTemplate(Objects.requireNonNull(transactionManager));
        if (!SAFE_SCHEMA.matcher(schema).matches()) {
            throw new IllegalArgumentException("DB_SCHEMA must be a simple PostgreSQL schema identifier");
        }
        this.table = '"' + schema + '"' + ".avatar_cleanup";
    }

    @Override
    public void enqueue(UUID userId, String objectKey) {
        if (userId == null || objectKey == null || objectKey.isBlank()) {
            return;
        }
        jdbc.update("insert into " + table + " (object_key, user_id) values (?, ?) on conflict do nothing",
                objectKey, userId);
    }

    @Scheduled(fixedDelayString = "${weav.avatar.storage.cleanup-interval-ms:30000}")
    public void reconcileNow() {
        List<Claimed> claimed;
        try {
            claimed = tx.execute(status -> claimBatch());
        } catch (RuntimeException exception) {
            log.warn("identity_avatar_cleanup_event action=CLAIM result=FAILED error={}",
                    exception.getClass().getSimpleName());
            return;
        }
        if (claimed == null) {
            return;
        }
        for (Claimed row : claimed) {
            try {
                storage.delete(row.userId(), row.objectKey());
                jdbc.update("delete from " + table + " where object_key = ?", row.objectKey());
                log.info("identity_avatar_cleanup_event userId={} objectKeyHash={} action=DELETE result=SUCCESS",
                        row.userId(), Integer.toHexString(row.objectKey().hashCode()));
            } catch (RuntimeException exception) {
                recordFailure(row, exception);
            }
        }
    }

    private List<Claimed> claimBatch() {
        List<Claimed> rows = jdbc.query("select object_key, user_id, attempts from " + table
                        + " where attempts < ? and next_attempt_at <= now() "
                        + "order by next_attempt_at, object_key limit ? for update skip locked",
                (rs, n) -> new Claimed(rs.getString(1), rs.getObject(2, UUID.class), rs.getInt(3)),
                MAX_ATTEMPTS, BATCH_SIZE);
        for (Claimed row : rows) {
            jdbc.update("update " + table + " set next_attempt_at = now() + (? * interval '1 second') "
                    + "where object_key = ?", LEASE_SECONDS, row.objectKey());
        }
        return rows;
    }

    private void recordFailure(Claimed row, RuntimeException exception) {
        int attempts = row.attempts() + 1;
        long delay = Math.min(MAX_BACKOFF_SECONDS, 5L * (1L << Math.min(attempts, 7)));
        try {
            jdbc.update("update " + table + " set attempts = ?, last_error = ?, "
                            + "next_attempt_at = now() + (? * interval '1 second') where object_key = ?",
                    attempts, exception.getClass().getSimpleName(), delay, row.objectKey());
        } catch (RuntimeException updateFailure) {
            log.warn("identity_avatar_cleanup_event userId={} action=DELETE result=RECORD_FAILED", row.userId());
        }
        if (attempts >= MAX_ATTEMPTS) {
            log.error("identity_avatar_cleanup_event userId={} objectKeyHash={} action=DELETE result=GAVE_UP attempts={}",
                    row.userId(), Integer.toHexString(row.objectKey().hashCode()), attempts);
        } else {
            log.warn("identity_avatar_cleanup_event userId={} objectKeyHash={} action=DELETE result=RETRYABLE attempts={}",
                    row.userId(), Integer.toHexString(row.objectKey().hashCode()), attempts);
        }
    }

    private record Claimed(String objectKey, UUID userId, int attempts) {
    }
}
