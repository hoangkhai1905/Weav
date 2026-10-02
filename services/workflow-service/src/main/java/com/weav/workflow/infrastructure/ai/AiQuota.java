package com.weav.workflow.infrastructure.ai;

import com.weav.workflow.application.node.NodeExecutor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

/** AI-2: durable per-workspace daily call budget shared by all replicas. A limit of 0 (default) disables it entirely. */
@Component
public class AiQuota {
    public static final String EXCEEDED = "AI_QUOTA_EXCEEDED";
    private static final Pattern SQL_IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final int dailyLimit;
    private final String table;

    public AiQuota(JdbcTemplate jdbc, PlatformTransactionManager transactionManager,
                   @Value("${spring.jpa.properties.hibernate.default_schema:workflow}") String schema,
                   @Value("${weav.workflow.ai.daily-limit-per-workspace:0}") int dailyLimit) {
        if (schema == null || !SQL_IDENTIFIER.matcher(schema).matches()) {
            throw new IllegalArgumentException("The configured workflow schema name is invalid");
        }
        if (dailyLimit < 0) {
            throw new IllegalArgumentException("The AI daily limit must not be negative");
        }
        this.jdbc = jdbc;
        this.transaction = new TransactionTemplate(transactionManager);
        this.transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.dailyLimit = dailyLimit;
        this.table = "\"" + schema + "\".ai_usage";
    }

    /** Spends one call from today's (UTC) budget; throws a non-retryable failure when it is used up. */
    public void consume(UUID workspaceId) {
        if (dailyLimit == 0) {
            return;
        }
        List<Integer> spent = transaction.execute(status -> jdbc.queryForList("""
                INSERT INTO %1$s (workspace_id, usage_date, call_count)
                VALUES (?, (now() AT TIME ZONE 'UTC')::date, 1)
                ON CONFLICT (workspace_id, usage_date) DO UPDATE SET call_count = %1$s.call_count + 1
                WHERE %1$s.call_count < ?
                RETURNING call_count
                """.formatted(table), Integer.class, workspaceId, dailyLimit));
        if (spent == null || spent.isEmpty()) {
            throw new NodeExecutor.Failure(EXCEEDED, "The daily AI limit for this workspace has been reached.", false);
        }
    }
}
