package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.application.port.out.WorkflowNotificationOutboxPort;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** P9: the long-running sweep skips its join when no enabled LONG_RUNNING rule exists. */
class AlertRuleAdapterOverdueTest {

    @Test
    void noEnabledLongRunningRuleReturnsEarlyWithoutTheJoin() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(contains("rule_type = 'LONG_RUNNING'"), eq(Boolean.class))).thenReturn(false);
        AlertRuleAdapter adapter = new AlertRuleAdapter(jdbc, mock(WorkflowNotificationOutboxPort.class), "workflow");

        assertTrue(adapter.overdueRuns(Instant.parse("2026-10-12T00:00:00Z"), 200).isEmpty());

        verify(jdbc, never()).query(anyString(), any(RowMapper.class), any(Object[].class));
    }

    @Test
    void anEnabledLongRunningRuleRunsTheOverdueQuery() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(contains("rule_type = 'LONG_RUNNING'"), eq(Boolean.class))).thenReturn(true);
        AlertRuleAdapter adapter = new AlertRuleAdapter(jdbc, mock(WorkflowNotificationOutboxPort.class), "workflow");

        adapter.overdueRuns(Instant.parse("2026-10-12T00:00:00Z"), 200);

        verify(jdbc, times(1)).query(contains("e.status IN ('RUNNING', 'WAITING')"), any(RowMapper.class),
                any(Object[].class));
    }
}
