package com.weav.workspace.infrastructure.messaging.notification;

import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.infrastructure.scheduling.OutboxWakeup;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

/** Neon scale-to-zero: the idle publisher sleeps until the next due row or the aligned cap, and a commit wakes it. */
@SpringBootTest(properties = {
        "management.health.rabbit.enabled=false",
        "weav.workspace.notification-outbox.publisher-enabled=false"
})
@Import(TestcontainersConfiguration.class)
class NotificationOutboxPublisherIdleIntegrationTest {

    @Autowired private JdbcTemplate jdbc;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private OutboxWakeup wakeup;

    private NotificationOutboxPublisher publisher;

    @BeforeEach
    void setUp() {
        jdbc.update("delete from workspace.notification_outbox");
        RabbitTemplate template = mock(RabbitTemplate.class);
        doAnswer(invocation -> {
            CorrelationData correlation = invocation.getArgument(3);
            correlation.getFuture().complete(new CorrelationData.Confirm(true, null));
            return null;
        }).when(template).send(anyString(), anyString(), any(Message.class), any(CorrelationData.class));
        publisher = new NotificationOutboxPublisher(jdbc, template, transactionManager,
                "workspace", "weav.events", 25, Duration.ofSeconds(5), Duration.ofSeconds(60), 10);
        publisher.configureIdleBackoff(1_000, Duration.ofMinutes(10), wakeup);
        wakeup.consume();
    }

    @Test
    void earliestPendingDueIgnoresPublishedAndFailedRowsAndFindsTheSoonestOne() {
        assertThat(publisher.earliestPendingDue()).isNull();
        jdbc.update("insert into workspace.notification_outbox (event_id, event_type, payload, published_at, next_attempt_at)"
                + " values (?, 'x', '{}'::jsonb, now(), now() - interval '1 hour')", UUID.randomUUID());
        jdbc.update("insert into workspace.notification_outbox (event_id, event_type, payload, failed_at, next_attempt_at)"
                + " values (?, 'x', '{}'::jsonb, now(), now() - interval '1 hour')", UUID.randomUUID());
        assertThat(publisher.earliestPendingDue()).isNull();
        for (int seconds : new int[] {300, 90}) {
            jdbc.update("insert into workspace.notification_outbox (event_id, event_type, payload, next_attempt_at)"
                    + " values (?, 'x', '{}'::jsonb, now() + (? * interval '1 second'))", UUID.randomUUID(), seconds);
        }

        Instant due = publisher.earliestPendingDue();

        assertThat(due).isBetween(Instant.now().plusSeconds(80), Instant.now().plusSeconds(95));
    }

    @Test
    void idlePublisherStaysAsleepUntilACommitWakesItThenPollsAtOnce() {
        publisher.publishPendingOnSchedule();
        UUID row = UUID.randomUUID();
        jdbc.update("insert into workspace.notification_outbox (event_id, event_type, payload)"
                + " values (?, 'x', '{}'::jsonb)", row);

        publisher.publishPendingOnSchedule();
        assertThat(publishedAt(row)).as("idle: the aligned cap has not elapsed").isNull();

        wakeup.signalAfterCommit();
        publisher.publishPendingOnSchedule();

        assertThat(publishedAt(row)).as("the wake ends the idle sleep").isNotNull();
    }

    private Object publishedAt(UUID eventId) {
        return jdbc.queryForObject("select published_at from workspace.notification_outbox where event_id = ?",
                Object.class, eventId);
    }
}
