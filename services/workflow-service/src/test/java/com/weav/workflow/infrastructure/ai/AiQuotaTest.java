package com.weav.workflow.infrastructure.ai;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.infrastructure.scheduling.RetentionPurgeJob;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** AI-2: the daily per-workspace budget against real PostgreSQL. */
@SpringBootTest(properties = {
        "weav.workflow.execution-outbox.initial-delay=3600000",
        "weav.workflow.execution-outbox.poll-interval=3600000"
})
@Import(WorkflowPublicationTestConfiguration.class)
class AiQuotaTest {
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private PlatformTransactionManager transactions;

    @Test
    void unlimitedByDefaultWritesNothing() {
        UUID workspace = UUID.randomUUID();
        AiQuota off = new AiQuota(jdbc, transactions, "workflow", 0);
        for (int i = 0; i < 5; i++) {
            off.consume(workspace);
        }
        assertEquals(0, rows(workspace));
    }

    @Test
    void thirdCallInTheSameUtcDayFailsNonRetryableWhenLimitIsTwo() {
        UUID workspace = UUID.randomUUID();
        AiQuota quota = new AiQuota(jdbc, transactions, "workflow", 2);
        quota.consume(workspace);
        quota.consume(workspace);

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class, () -> quota.consume(workspace));

        assertEquals("AI_QUOTA_EXCEEDED", failure.code());
        assertFalse(failure.retryable());
        assertEquals(2, jdbc.queryForObject(
                "select call_count from workflow.ai_usage where workspace_id = ?", Integer.class, workspace));
        quota.consume(UUID.randomUUID()); // another workspace is unaffected
    }

    @Test
    void retentionPurgeRemovesUsageOlderThanThirtyDays() {
        UUID workspace = UUID.randomUUID();
        jdbc.update("insert into workflow.ai_usage (workspace_id, usage_date, call_count) values "
                + "(?, (now() at time zone 'UTC')::date - 31, 5), (?, (now() at time zone 'UTC')::date - 1, 5)",
                workspace, workspace);

        new RetentionPurgeJob(jdbc, transactions, "workflow", 7, 14, 0).purgeNow();

        assertEquals(1, rows(workspace));
    }

    private int rows(UUID workspace) {
        return jdbc.queryForObject("select count(*) from workflow.ai_usage where workspace_id = ?",
                Integer.class, workspace);
    }
}
