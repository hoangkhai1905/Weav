package com.weav.workflow.infrastructure.scheduling;

import org.junit.jupiter.api.Test;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** G11: one failing purge step is logged and the following steps still run. */
class RetentionPurgeStepIsolationTest {

    @Test
    void aFailingStepDoesNotSkipTheRemainingSteps() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
        when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenReturn(true);
        when(jdbc.update(contains("\"workflow\".outbox_events"), any(Object[].class)))
                .thenThrow(new QueryTimeoutException("statement timeout"));

        new RetentionPurgeJob(jdbc, transactions, "workflow", 7, 14, 0).purgeNow();

        verify(jdbc, times(1)).update(contains("\"workflow\".notification_outbox"), any(Object[].class));
        verify(jdbc, times(1)).update(contains("\"workflow\".ai_usage"));
        verify(jdbc, times(1)).update(contains("\"workflow\".alert_rule_firings"), any(Object[].class));
    }

    /** F5: executions are purged 100 at a time, and a timed-out batch is logged without failing the run. */
    @Test
    void aTimedOutExecutionBatchIsLoggedAndTheRunCompletes() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
        when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenReturn(true);
        when(jdbc.queryForList(contains("\"workflow\".workflow_executions"), eq(UUID.class), any(Object[].class)))
                .thenThrow(new QueryTimeoutException("statement timeout"));

        assertDoesNotThrow(() -> new RetentionPurgeJob(jdbc, transactions, "workflow", 7, 14, 30).purgeNow());

        verify(jdbc, times(1)).queryForList(contains("\"workflow\".workflow_executions"), eq(UUID.class),
                eq(30), eq(100));
    }

    @Test
    void aFullExecutionBatchOfOneHundredIsFollowedByAnotherBatch() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
        when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenReturn(true);
        List<UUID> full = java.util.stream.Stream.generate(UUID::randomUUID).limit(100).toList();
        when(jdbc.queryForList(contains("\"workflow\".workflow_executions"), eq(UUID.class), any(Object[].class)))
                .thenReturn(full).thenReturn(List.of());

        new RetentionPurgeJob(jdbc, transactions, "workflow", 7, 14, 30).purgeNow();

        verify(jdbc, times(2)).queryForList(contains("\"workflow\".workflow_executions"), eq(UUID.class),
                eq(30), eq(100));
    }
}
