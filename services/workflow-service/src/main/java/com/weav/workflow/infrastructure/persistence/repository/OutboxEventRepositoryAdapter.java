package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.domain.model.aggregate.workflow.OutboxEvent;
import com.weav.workflow.domain.port.out.OutboxEventRepository;
import com.weav.workflow.domain.valueobject.OutboxStatus;
import com.weav.workflow.infrastructure.persistence.entity.OutboxEventJpaEntity;
import com.weav.workflow.infrastructure.persistence.mapper.ExecutionPersistenceMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/** Short, fenced PostgreSQL claims for outbox delivery; message sends occur outside these transactions. */
@Repository
public class OutboxEventRepositoryAdapter implements OutboxEventRepository {
    private static final Pattern SQL_IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");

    @PersistenceContext
    private EntityManager entityManager;

    private final JdbcTemplate jdbcTemplate;
    private final ExecutionPersistenceMapper mapper;
    private final String outboxTable;

    public OutboxEventRepositoryAdapter(JdbcTemplate jdbcTemplate, ExecutionPersistenceMapper mapper,
                                        @Value("${spring.jpa.properties.hibernate.default_schema:workflow}") String schema) {
        this.jdbcTemplate = Objects.requireNonNull(jdbcTemplate, "jdbcTemplate must not be null");
        this.mapper = Objects.requireNonNull(mapper, "mapper must not be null");
        if (schema == null || !SQL_IDENTIFIER.matcher(schema).matches()) {
            throw new IllegalArgumentException("The configured workflow schema name is invalid");
        }
        this.outboxTable = "\"" + schema + "\".outbox_events";
    }

    @Override
    @Transactional
    public OutboxEvent save(OutboxEvent event) {
        Objects.requireNonNull(event, "event must not be null");
        OutboxEventJpaEntity entity = mapper.toEntity(event);
        if (entityManager.find(OutboxEventJpaEntity.class, event.getId()) == null) {
            entityManager.persist(entity);
        } else {
            entityManager.merge(entity);
        }
        return event;
    }

    @Override
    @Transactional(readOnly = true)
    public List<OutboxEvent> findPending(int limit) {
        if (limit < 1 || limit > 1_000) {
            throw new IllegalArgumentException("Outbox query limit must be between one and one thousand");
        }
        return entityManager.createQuery(
                        "select event from OutboxEventJpaEntity event where event.status = :status "
                                + "order by event.createdAt, event.id",
                        OutboxEventJpaEntity.class)
                .setParameter("status", OutboxStatus.PENDING)
                .setMaxResults(limit)
                .getResultList()
                .stream()
                .map(mapper::toDomain)
                .toList();
    }

    @Override
    @Transactional
    public List<OutboxEvent> claimPending(UUID leaseToken, Instant now, Instant leaseUntil, int limit) {
        Objects.requireNonNull(leaseToken, "leaseToken must not be null");
        Objects.requireNonNull(now, "now must not be null");
        Objects.requireNonNull(leaseUntil, "leaseUntil must not be null");
        if (!leaseUntil.isAfter(now) || limit < 1 || limit > 1_000) {
            throw new IllegalArgumentException("Outbox lease bounds are invalid");
        }
        String claimSql = "with candidates as ("
                + "select id from " + outboxTable + " where status = 'PENDING' and next_attempt_at <= ? "
                + "and (publisher_lease_until is null or publisher_lease_until <= ?) "
                + "order by created_at, id limit ? for update skip locked) "
                + "update " + outboxTable + " as target set publisher_lease_token = ?, publisher_lease_until = ? "
                + "from candidates where target.id = candidates.id returning target.id";
        List<UUID> ids = jdbcTemplate.query(claimSql,
                (resultSet, rowNumber) -> resultSet.getObject(1, UUID.class),
                Timestamp.from(now), Timestamp.from(now), limit, leaseToken, Timestamp.from(leaseUntil));
        return ids.stream()
                .map(id -> entityManager.find(OutboxEventJpaEntity.class, id))
                .filter(Objects::nonNull)
                .map(mapper::toDomain)
                .toList();
    }

    @Override
    @Transactional
    public boolean markPublished(UUID eventId, UUID leaseToken, Instant publishedAt) {
        Objects.requireNonNull(eventId, "eventId must not be null");
        Objects.requireNonNull(leaseToken, "leaseToken must not be null");
        Objects.requireNonNull(publishedAt, "publishedAt must not be null");
        int changed = jdbcTemplate.update("update " + outboxTable
                        + " set status = 'PUBLISHED', published_at = ?, publisher_lease_token = null, "
                        + "publisher_lease_until = null where id = ? and status = 'PENDING' "
                        + "and publisher_lease_token = ?",
                Timestamp.from(publishedAt), eventId, leaseToken);
        return changed == 1;
    }

    @Override
    @Transactional
    public boolean scheduleRetry(UUID eventId, UUID leaseToken, Instant attemptedAt, Instant nextAttemptAt) {
        Objects.requireNonNull(eventId, "eventId must not be null");
        Objects.requireNonNull(leaseToken, "leaseToken must not be null");
        Objects.requireNonNull(attemptedAt, "attemptedAt must not be null");
        Objects.requireNonNull(nextAttemptAt, "nextAttemptAt must not be null");
        if (nextAttemptAt.isBefore(attemptedAt)) {
            throw new IllegalArgumentException("Outbox retry time cannot precede the attempt");
        }
        int changed = jdbcTemplate.update("update " + outboxTable
                        + " set retry_count = case when retry_count < 2147483647 "
                        + "then retry_count + 1 else retry_count end, next_attempt_at = ?, "
                        + "publisher_lease_token = null, "
                        + "publisher_lease_until = null where id = ? and status = 'PENDING' "
                        + "and publisher_lease_token = ?",
                Timestamp.from(nextAttemptAt), eventId, leaseToken);
        return changed == 1;
    }
}
