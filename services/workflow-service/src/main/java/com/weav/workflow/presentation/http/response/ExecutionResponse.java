package com.weav.workflow.presentation.http.response;

import com.weav.workflow.application.dto.ExecutionResultDto;
import com.weav.workflow.application.port.out.ExecutionQueryPort;
import com.weav.workflow.domain.valueobject.AttemptStatus;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import com.weav.workflow.domain.valueobject.LogLevel;
import com.weav.workflow.domain.valueobject.NodeExecutionStatus;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** HTTP response projections with no persistence entities or lazy associations. */
public final class ExecutionResponse {
    private ExecutionResponse() {
    }

    public record Accepted(UUID executionId, UUID workflowId, UUID workflowVersionId, ExecutionStatus status) {
        public static Accepted from(ExecutionResultDto result) {
            return new Accepted(result.executionId(), result.workflowId(), result.workflowVersionId(), result.status());
        }
    }

    public record Page(List<Summary> items, int page, int size, long totalElements, boolean hasNext) {
        public static Page from(ExecutionQueryPort.ExecutionPage page) {
            return new Page(page.items().stream().map(Summary::from).toList(), page.page(), page.size(),
                    page.totalElements(), (long) (page.page() + 1) * page.size() < page.totalElements());
        }
    }

    public record Summary(UUID executionId, UUID workflowId, UUID workflowVersionId,
                          ExecutionStatus status, ExecutionTriggerType triggerType,
                          Instant createdAt, Instant startedAt, Instant finishedAt) {
        private static Summary from(ExecutionQueryPort.ExecutionSummary summary) {
            return new Summary(summary.executionId(), summary.workflowId(), summary.workflowVersionId(),
                    summary.status(), summary.triggerType(), summary.createdAt(), summary.startedAt(),
                    summary.finishedAt());
        }
    }

    public record Detail(UUID executionId, UUID workflowId, UUID workflowVersionId,
                         ExecutionStatus status, ExecutionTriggerType triggerType,
                         Instant createdAt, Instant startedAt, Instant finishedAt,
                         List<Node> nodes, LogPage logs) {
        public static Detail from(ExecutionQueryPort.ExecutionDetail detail) {
            ExecutionQueryPort.ExecutionSummary summary = detail.summary();
            return new Detail(summary.executionId(), summary.workflowId(), summary.workflowVersionId(),
                    summary.status(), summary.triggerType(), summary.createdAt(), summary.startedAt(),
                    summary.finishedAt(), detail.nodes().stream().map(Node::from).toList(),
                    LogPage.from(detail.logs()));
        }
    }

    public record Node(UUID nodeExecutionId, String nodeId, String nodeType, NodeExecutionStatus status,
                       int attemptCount, Instant startedAt, Instant finishedAt,
                       Object output, Object error, List<Attempt> attempts) {
        private static Node from(ExecutionQueryPort.NodeState node) {
            return new Node(node.nodeExecutionId(), node.nodeId(), node.nodeType(), node.status(),
                    node.attemptCount(), node.startedAt(), node.finishedAt(), node.output(), node.error(),
                    node.attempts().stream().map(Attempt::from).toList());
        }
    }

    public record Attempt(UUID attemptId, int attemptNumber, AttemptStatus status,
                          Instant startedAt, Instant finishedAt, Object output, Object error) {
        private static Attempt from(ExecutionQueryPort.AttemptState attempt) {
            return new Attempt(attempt.attemptId(), attempt.attemptNumber(), attempt.status(),
                    attempt.startedAt(), attempt.finishedAt(), attempt.output(), attempt.error());
        }
    }

    public record LogPage(List<LogEntry> items, int page, int size, long totalElements, boolean hasNext) {
        private static LogPage from(ExecutionQueryPort.LogPage page) {
            return new LogPage(page.items().stream().map(LogEntry::from).toList(), page.page(), page.size(),
                    page.totalElements(), page.hasNext());
        }
    }

    public record LogEntry(UUID id, UUID nodeExecutionId, UUID attemptId, LogLevel level,
                           String eventType, String message, Map<String, Object> metadata, Instant createdAt) {
        private static LogEntry from(ExecutionQueryPort.LogEntry entry) {
            return new LogEntry(entry.id(), entry.nodeExecutionId(), entry.attemptId(), entry.level(),
                    entry.eventType(), entry.message(), entry.metadata(), entry.createdAt());
        }
    }
}
