package com.weav.identity.infrastructure.persistence;

import com.weav.identity.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

@Import(TestcontainersConfiguration.class)
@SpringBootTest(properties = {
        "weav.identity.notification-outbox.retention-days=14",
        "weav.identity.notification-outbox.publisher-enabled=false"
})
class NotificationOutboxRetentionPurgeJobIntegrationTest {

    @Autowired private NotificationOutboxRetentionPurgeJob job;
    @Autowired private JdbcTemplate jdbc;

    @Test
    void purgesOnlyRowsPublishedBeyondRetention() {
        UUID oldPublished = insert(30, 20);
        UUID recentPublished = insert(5, 2);
        UUID oldUnpublished = insert(60, null);

        job.purgeNow();

        assertEquals(0, count(oldPublished));
        assertEquals(1, count(recentPublished));
        assertEquals(1, count(oldUnpublished));
    }

    private UUID insert(int createdDaysAgo, Integer publishedDaysAgo) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into identity.notification_outbox (event_id, event_type, payload, created_at, published_at)"
                        + " values (?, 'identity.test', '{}'::jsonb, now() - (? * interval '1 day'),"
                        + " case when cast(? as integer) is null then null else now() - (cast(? as integer) * interval '1 day') end)",
                id, createdDaysAgo, publishedDaysAgo, publishedDaysAgo);
        return id;
    }

    private int count(UUID id) {
        return jdbc.queryForObject("select count(*) from identity.notification_outbox where event_id = ?",
                Integer.class, id);
    }
}
