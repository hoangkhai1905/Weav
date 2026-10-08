package com.weav.workflow.presentation.http.response;

import com.weav.workflow.application.port.out.AlertRuleStore.AlertRule;
import com.weav.workflow.application.port.out.MonitoringQueryPort;
import com.weav.workflow.application.service.AlertRuleService;
import com.weav.workflow.application.service.MonitoringService;
import com.weav.workflow.domain.valueobject.AlertRuleType;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** HTTP projections for run history, the monitoring summary and alert rules. */
public final class MonitoringResponse {
    private MonitoringResponse() {
    }

    public record RunPage(List<Run> items, int page, int size, long totalElements, boolean hasNext) {
        public static RunPage from(MonitoringQueryPort.RunPage page) {
            return new RunPage(page.items().stream().map(Run::from).toList(), page.page(), page.size(),
                    page.totalElements(), (long) (page.page() + 1) * page.size() < page.totalElements());
        }
    }

    /** {@code startedAt} is null while a run is queued; {@code durationMs} needs both startedAt and finishedAt. */
    public record Run(UUID executionId, UUID workflowId, String workflowName, ExecutionStatus status,
                      ExecutionTriggerType triggerType, Instant createdAt, Instant startedAt, Instant finishedAt,
                      Long durationMs, String errorCode, String errorMessage) {
        static Run from(MonitoringQueryPort.RunItem item) {
            Long duration = item.startedAt() != null && item.finishedAt() != null
                    ? Math.max(0, item.finishedAt().toEpochMilli() - item.startedAt().toEpochMilli())
                    : null;
            return new Run(item.executionId(), item.workflowId(), item.workflowName(), item.status(),
                    item.triggerType(), item.createdAt(), item.startedAt(), item.finishedAt(), duration,
                    item.errorCode(), item.errorMessage());
        }
    }

    public record Summary(int days, Instant from, Instant to, Workflows workflows, Runs runs, Double successRate,
                          Long averageDurationMs, Long p95DurationMs, List<Day> trend,
                          List<FailingWorkflow> topFailingWorkflows, List<Run> recentFailures) {
        public static Summary from(MonitoringService.Summary summary) {
            MonitoringQueryPort.WorkflowCounts workflows = summary.workflows();
            MonitoringQueryPort.RunCounts runs = summary.runs();
            return new Summary(summary.days(), summary.from(), summary.to(),
                    new Workflows(workflows.published(), workflows.paused(), workflows.draft()),
                    new Runs(runs.total(), runs.today(), runs.success(), runs.failed(), runs.active()),
                    summary.successRate(), runs.avgDurationMs(), runs.p95DurationMs(),
                    summary.trend().stream().map(Day::from).toList(),
                    summary.topFailing().stream().map(FailingWorkflow::from).toList(),
                    summary.recentFailures().stream().map(Run::from).toList());
        }
    }

    public record Workflows(long published, long paused, long draft) {
    }

    public record Runs(long total, long today, long success, long failed, long active) {
    }

    public record Day(LocalDate date, long total, long success, long failed) {
        static Day from(MonitoringQueryPort.DayCount day) {
            return new Day(day.day(), day.total(), day.success(), day.failed());
        }
    }

    public record FailingWorkflow(UUID workflowId, String workflowName, long failures, Instant lastFailureAt) {
        static FailingWorkflow from(MonitoringQueryPort.FailingWorkflow item) {
            return new FailingWorkflow(item.workflowId(), item.workflowName(), item.failures(),
                    item.lastFailureAt());
        }
    }

    public record Rule(UUID id, UUID workspaceId, UUID workflowId, String name, AlertRuleType type, int threshold,
                       Integer windowMinutes, int cooldownMinutes, boolean enabled, UUID createdBy,
                       Instant createdAt, Instant updatedAt) {
        public static Rule from(AlertRule rule) {
            return new Rule(rule.id(), rule.workspaceId(), rule.workflowId(), rule.name(), rule.type(),
                    rule.threshold(), rule.windowMinutes(), rule.cooldownMinutes(), rule.enabled(),
                    rule.createdBy(), rule.createdAt(), rule.updatedAt());
        }
    }

    public record RuleList(List<Rule> items, int maxRules) {
        public static RuleList from(List<AlertRule> rules) {
            return new RuleList(rules.stream().map(Rule::from).toList(),
                    AlertRuleService.MAX_RULES_PER_WORKSPACE);
        }
    }
}
