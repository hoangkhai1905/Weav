package com.weav.workspace.infrastructure.messaging.notification;

import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

class NotificationOutboxPublisherTest {

    @Test
    void rejectsConfirmDeadlineAboveThirtySeconds() {
        assertThatThrownBy(() -> publisher(Duration.ofSeconds(31), Duration.ofSeconds(60)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Workspace notification outbox bounds are invalid");
    }

    @Test
    void rejectsConfirmDeadlineBelowOneMillisecond() {
        assertThatThrownBy(() -> publisher(Duration.ofNanos(1), Duration.ofSeconds(60)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Workspace notification outbox bounds are invalid");
    }

    @Test
    void rejectsRetryCapAboveSixtySeconds() {
        assertThatThrownBy(() -> publisher(Duration.ofSeconds(5), Duration.ofSeconds(61)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Workspace notification outbox bounds are invalid");
    }

    @Test
    void rejectsRetryCapBelowOneMillisecond() {
        assertThatThrownBy(() -> publisher(Duration.ofSeconds(5), Duration.ofNanos(1)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Workspace notification outbox bounds are invalid");
    }

    @Test
    void acceptsTheMaximumConfirmAndRetryDurations() {
        assertThatCode(() -> publisher(Duration.ofSeconds(30), Duration.ofSeconds(60)))
                .doesNotThrowAnyException();
    }

    private NotificationOutboxPublisher publisher(Duration confirmTimeout, Duration maxRetryDelay) {
        return new NotificationOutboxPublisher(
                mock(JdbcTemplate.class),
                mock(RabbitTemplate.class),
                mock(PlatformTransactionManager.class),
                "workspace",
                "weav.events",
                25,
                confirmTimeout,
                maxRetryDelay);
    }
}
