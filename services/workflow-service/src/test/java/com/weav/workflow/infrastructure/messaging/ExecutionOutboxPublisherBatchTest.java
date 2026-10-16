package com.weav.workflow.infrastructure.messaging;

import com.weav.workflow.domain.model.aggregate.execution.WorkflowExecution;
import com.weav.workflow.domain.model.aggregate.workflow.OutboxEvent;
import com.weav.workflow.domain.port.out.OutboxEventRepository;
import com.weav.workflow.domain.port.out.WorkflowExecutionRepository;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.amqp.core.MessagePostProcessor;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import tools.jackson.databind.json.JsonMapper;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** B11: a claimed batch loads its executions with one query and awaits the broker confirms together. */
class ExecutionOutboxPublisherBatchTest {
    private static final Instant NOW = Instant.parse("2026-10-12T00:00:00Z");

    private final OutboxEventRepository outbox = mock(OutboxEventRepository.class);
    private final WorkflowExecutionRepository executions = mock(WorkflowExecutionRepository.class);
    private final RabbitTemplate rabbit = mock(RabbitTemplate.class);
    private final ExecutionOutboxPublisher publisher = new ExecutionOutboxPublisher(outbox, executions, rabbit,
            JsonMapper.builder().build(), Clock.fixed(NOW, ZoneOffset.UTC), 10, Duration.ofSeconds(30),
            Duration.ofMillis(300), Duration.ofSeconds(60));

    private WorkflowExecution execution(UUID id) {
        WorkflowExecution execution = mock(WorkflowExecution.class);
        when(execution.getId()).thenReturn(id);
        return execution;
    }

    private OutboxEvent event(UUID executionId) {
        return OutboxEvent.pending("WORKFLOW_EXECUTION", executionId, "EXECUTION_REQUESTED", Map.of());
    }

    /** Acks every message at once, except those whose outbox event id is listed (the broker stays silent). */
    private void confirmAllExcept(List<UUID> silentEventIds) {
        doAnswer(invocation -> {
            CorrelationData correlation = invocation.getArgument(4);
            if (!silentEventIds.contains(UUID.fromString(correlation.getId()))) {
                correlation.getFuture().complete(new CorrelationData.Confirm(true, null));
            }
            return null;
        }).when(rabbit).convertAndSend(anyString(), anyString(), any(Object.class), any(MessagePostProcessor.class),
                any(CorrelationData.class));
    }

    @Test
    void aBatchUsesOneExecutionQueryAndSendsEverythingBeforeSettlingAnyConfirm() {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        UUID c = UUID.randomUUID();
        when(outbox.claimPending(any(UUID.class), any(Instant.class), any(Instant.class), anyInt()))
                .thenReturn(List.of(event(a), event(b), event(c)));
        List<WorkflowExecution> loaded = List.of(execution(a), execution(b), execution(c));
        when(executions.findAllById(anyCollection())).thenReturn(loaded);
        when(outbox.markPublished(any(UUID.class), any(UUID.class), any(Instant.class))).thenReturn(true);
        confirmAllExcept(List.of());

        assertEquals(3, publisher.publishPending());

        verify(executions, times(1)).findAllById(anyCollection());
        verify(executions, never()).findById(any(UUID.class));
        InOrder order = inOrder(rabbit, outbox);
        order.verify(rabbit, times(3)).convertAndSend(anyString(), anyString(), any(Object.class),
                any(MessagePostProcessor.class), any(CorrelationData.class));
        order.verify(outbox, times(3)).markPublished(any(UUID.class), any(UUID.class), any(Instant.class));
        verify(outbox, never()).scheduleRetry(any(UUID.class), any(UUID.class), any(Instant.class),
                any(Instant.class));
    }

    @Test
    void aMissingExecutionAndAnUnconfirmedMessageAreRescheduledWithoutBlockingTheRest() {
        UUID ok = UUID.randomUUID();
        UUID gone = UUID.randomUUID();
        UUID silent = UUID.randomUUID();
        OutboxEvent okEvent = event(ok);
        OutboxEvent goneEvent = event(gone);
        OutboxEvent silentEvent = event(silent);
        when(outbox.claimPending(any(UUID.class), any(Instant.class), any(Instant.class), anyInt()))
                .thenReturn(List.of(okEvent, goneEvent, silentEvent));
        List<WorkflowExecution> loaded = List.of(execution(ok), execution(silent));
        when(executions.findAllById(anyCollection())).thenReturn(loaded);
        when(outbox.markPublished(eq(okEvent.getId()), any(UUID.class), any(Instant.class))).thenReturn(true);
        confirmAllExcept(List.of(silentEvent.getId()));

        long started = System.nanoTime();
        assertEquals(1, publisher.publishPending());
        long elapsedMillis = (System.nanoTime() - started) / 1_000_000;

        verify(outbox).scheduleRetry(eq(goneEvent.getId()), any(UUID.class), eq(NOW), any(Instant.class));
        verify(outbox).scheduleRetry(eq(silentEvent.getId()), any(UUID.class), eq(NOW), any(Instant.class));
        verify(outbox, never()).markPublished(eq(goneEvent.getId()), any(UUID.class), any(Instant.class));
        verify(outbox, never()).markPublished(eq(silentEvent.getId()), any(UUID.class), any(Instant.class));
        // one shared confirm deadline (300 ms), not one wait per event
        assertTrue(elapsedMillis < 1_500, "waited " + elapsedMillis + " ms");
    }

    @Test
    void aStaleLeaseOnMarkPublishedDoesNotCountAsPublished() {
        UUID a = UUID.randomUUID();
        when(outbox.claimPending(any(UUID.class), any(Instant.class), any(Instant.class), anyInt()))
                .thenReturn(List.of(event(a)));
        List<WorkflowExecution> loaded = List.of(execution(a));
        when(executions.findAllById(anyCollection())).thenReturn(loaded);
        when(outbox.markPublished(any(UUID.class), any(UUID.class), any(Instant.class))).thenReturn(false);
        confirmAllExcept(List.of());

        assertEquals(0, publisher.publishPending());
    }

    @Test
    void aDatabaseFailureWhileSettlingOneEventDoesNotStopTheRestOfTheBatch() {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        UUID c = UUID.randomUUID();
        OutboxEvent first = event(a);
        OutboxEvent second = event(b);
        OutboxEvent third = event(c);
        when(outbox.claimPending(any(UUID.class), any(Instant.class), any(Instant.class), anyInt()))
                .thenReturn(List.of(first, second, third));
        List<WorkflowExecution> loaded = List.of(execution(a), execution(b), execution(c));
        when(executions.findAllById(anyCollection())).thenReturn(loaded);
        when(outbox.markPublished(eq(first.getId()), any(UUID.class), any(Instant.class)))
                .thenThrow(new org.springframework.dao.DataAccessResourceFailureException("blip"));
        when(outbox.scheduleRetry(eq(first.getId()), any(UUID.class), any(Instant.class), any(Instant.class)))
                .thenThrow(new org.springframework.dao.DataAccessResourceFailureException("blip"));
        when(outbox.markPublished(eq(second.getId()), any(UUID.class), any(Instant.class))).thenReturn(true);
        when(outbox.markPublished(eq(third.getId()), any(UUID.class), any(Instant.class))).thenReturn(true);
        confirmAllExcept(List.of());

        assertEquals(2, publisher.publishPending());

        verify(outbox).markPublished(eq(second.getId()), any(UUID.class), any(Instant.class));
        verify(outbox).markPublished(eq(third.getId()), any(UUID.class), any(Instant.class));
    }
}
