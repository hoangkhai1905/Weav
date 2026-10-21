package com.weav.workflow.presentation.http;

import com.weav.workflow.application.port.out.AdminExecutionQueryPort;
import com.weav.workflow.application.port.out.MonitoringQueryPort;
import com.weav.workflow.application.service.AdminExecutionService;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import com.weav.workflow.domain.valueobject.NodeExecutionStatus;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.UUID;

/** UC028: cross-workspace run listing for system admins ({@code system_role=ADMIN}); no node payloads. */
@RestController
@RequestMapping("/admin/executions")
public class AdminExecutionController {
    private final AdminExecutionService service;

    public AdminExecutionController(AdminExecutionService service) {
        this.service = service;
    }

    @GetMapping
    public RunPage history(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(name = "status", required = false) String status,
            @RequestParam(name = "workspaceId", required = false) UUID workspaceId,
            @RequestParam(name = "from", required = false) String from,
            @RequestParam(name = "to", required = false) String to,
            @RequestParam(name = "page", defaultValue = "0") @Min(0) int page,
            @RequestParam(name = "size", defaultValue = "20") @Min(1) @Max(100) int size) {
        requireAdmin(jwt);
        return RunPage.from(service.history(parseStatus(status), workspaceId, parseInstant(from, "from"),
                parseInstant(to, "to"), page, size));
    }

    @GetMapping("/summary")
    public Summary summary(@AuthenticationPrincipal Jwt jwt,
                           @RequestParam(name = "hours", defaultValue = "24") int hours) {
        requireAdmin(jwt);
        return Summary.from(service.summary(hours));
    }

    @GetMapping("/{executionId}")
    public Detail detail(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID executionId) {
        requireAdmin(jwt);
        return Detail.from(service.detail(executionId));
    }

    private static void requireAdmin(Jwt jwt) {
        if (jwt == null || !"ADMIN".equals(jwt.getClaimAsString("system_role"))) {
            throw new ForbiddenException();
        }
    }

    private static ExecutionStatus parseStatus(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return ExecutionStatus.valueOf(value);
        } catch (IllegalArgumentException exception) {
            throw new BadRequestException("status is not a valid execution status");
        }
    }

    private static Instant parseInstant(String value, String name) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(value);
        } catch (DateTimeParseException exception) {
            throw new BadRequestException(name + " must be an ISO-8601 instant such as 2026-10-08T00:00:00Z");
        }
    }

    private static Long millisBetween(MonitoringQueryPort.RunItem run) {
        return run.startedAt() != null && run.finishedAt() != null
                ? Math.max(0, run.finishedAt().toEpochMilli() - run.startedAt().toEpochMilli()) : null;
    }

    public record RunPage(List<Item> items, int page, int size, long totalElements, boolean hasNext) {
        static RunPage from(AdminExecutionQueryPort.AdminRunPage page) {
            return new RunPage(page.items().stream().map(Item::from).toList(), page.page(), page.size(),
                    page.totalElements(), (long) (page.page() + 1) * page.size() < page.totalElements());
        }
    }

    public record Item(UUID executionId, UUID workflowId, String workflowName, UUID workspaceId,
                       ExecutionStatus status, ExecutionTriggerType triggerType, Instant createdAt,
                       Instant startedAt, Long durationMs, String errorCode) {
        static Item from(AdminExecutionQueryPort.AdminRunItem item) {
            MonitoringQueryPort.RunItem run = item.run();
            return new Item(run.executionId(), run.workflowId(), run.workflowName(), item.workspaceId(),
                    run.status(), run.triggerType(), run.createdAt(), run.startedAt(), millisBetween(run),
                    run.errorCode());
        }
    }

    public record Detail(UUID executionId, UUID workflowId, String workflowName, UUID workspaceId,
                         ExecutionStatus status, ExecutionTriggerType triggerType, Instant createdAt,
                         Instant startedAt, Instant finishedAt, String errorCode, String errorMessage,
                         List<Step> steps) {
        static Detail from(AdminExecutionQueryPort.AdminRunDetail detail) {
            MonitoringQueryPort.RunItem run = detail.run().run();
            return new Detail(run.executionId(), run.workflowId(), run.workflowName(),
                    detail.run().workspaceId(), run.status(), run.triggerType(), run.createdAt(),
                    run.startedAt(), run.finishedAt(), run.errorCode(), run.errorMessage(),
                    detail.steps().stream().map(Step::from).toList());
        }
    }

    public record Step(String nodeId, String nodeType, NodeExecutionStatus status, int attemptCount,
                       Instant startedAt, Instant finishedAt, String errorCode, String errorMessage) {
        static Step from(AdminExecutionQueryPort.AdminStep step) {
            return new Step(step.nodeId(), step.nodeType(), step.status(), step.attemptCount(), step.startedAt(),
                    step.finishedAt(), step.errorCode(), step.errorMessage());
        }
    }

    public record Summary(int hours, Instant from, Instant to, long total, long success, long failed, long active) {
        static Summary from(AdminExecutionService.Summary summary) {
            AdminExecutionQueryPort.AdminCounts counts = summary.counts();
            return new Summary(summary.hours(), summary.from(), summary.to(), counts.total(), counts.success(),
                    counts.failed(), counts.active());
        }
    }
}
