package com.weav.workflow.infrastructure.messaging;

import com.weav.workflow.domain.port.out.OutboxEventRepository;
import com.weav.workflow.domain.port.out.WorkflowExecutionRepository;
import com.weav.workflow.infrastructure.scheduling.OutboxWakeup;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.dao.DataAccessResourceFailureException;
import tools.jackson.databind.json.JsonMapper;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** G11: a failing scheduled poll is logged instead of escaping into the shared scheduler. */
class ExecutionOutboxPublisherPollTest {

    @Test
    void scheduledPollSwallowsAndLogsRepositoryFailures() {
        OutboxEventRepository outbox = mock(OutboxEventRepository.class);
        when(outbox.claimPending(any(UUID.class), any(Instant.class), any(Instant.class), anyInt()))
                .thenThrow(new DataAccessResourceFailureException("database unavailable"));
        ExecutionOutboxPublisher publisher = new ExecutionOutboxPublisher(outbox,
                mock(WorkflowExecutionRepository.class), mock(RabbitTemplate.class), JsonMapper.builder().build(),
                Clock.fixed(Instant.parse("2026-10-12T00:00:00Z"), ZoneOffset.UTC), 5, Duration.ofSeconds(30),
                Duration.ofSeconds(1), Duration.ofSeconds(60));

        assertDoesNotThrow(publisher::publishPendingOnSchedule);
    }

    /** Batch 5: an idle publisher skips database polls until its backoff elapses or a local write wakes it. */
    @Test
    void idlePublisherSkipsPollsUntilWokenByACommittedWrite() {
        OutboxEventRepository outbox = mock(OutboxEventRepository.class);
        when(outbox.claimPending(any(UUID.class), any(Instant.class), any(Instant.class), anyInt()))
                .thenReturn(List.of());
        ExecutionOutboxPublisher publisher = new ExecutionOutboxPublisher(outbox,
                mock(WorkflowExecutionRepository.class), mock(RabbitTemplate.class), JsonMapper.builder().build(),
                Clock.fixed(Instant.parse("2026-10-12T00:00:00Z"), ZoneOffset.UTC), 5, Duration.ofSeconds(30),
                Duration.ofSeconds(1), Duration.ofSeconds(60));
        OutboxWakeup wakeup = new OutboxWakeup();
        publisher.configureIdleBackoff(1_000, Duration.ofSeconds(30), wakeup);

        publisher.publishPendingOnSchedule();
        publisher.publishPendingOnSchedule();
        publisher.publishPendingOnSchedule();
        verify(outbox, times(1)).claimPending(any(UUID.class), any(Instant.class), any(Instant.class), anyInt());

        wakeup.signalAfterCommit();
        publisher.publishPendingOnSchedule();
        verify(outbox, times(2)).claimPending(any(UUID.class), any(Instant.class), any(Instant.class), anyInt());
    }
}
