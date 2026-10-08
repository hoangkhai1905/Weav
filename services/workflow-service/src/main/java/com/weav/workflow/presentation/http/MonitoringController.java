package com.weav.workflow.presentation.http;

import com.weav.workflow.application.service.AlertRuleService;
import com.weav.workflow.application.service.MonitoringService;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.presentation.http.request.AlertRuleRequest;
import com.weav.workflow.presentation.http.response.MonitoringResponse;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.UUID;

/** Workspace-wide run history, metrics summary and alert rules (W6-A monitoring). */
@RestController
@RequestMapping("/workspaces/{workspaceId}")
public class MonitoringController {
    private final MonitoringService monitoringService;
    private final AlertRuleService alertRuleService;

    public MonitoringController(MonitoringService monitoringService, AlertRuleService alertRuleService) {
        this.monitoringService = monitoringService;
        this.alertRuleService = alertRuleService;
    }

    @GetMapping("/executions")
    public MonitoringResponse.RunPage history(
            @PathVariable UUID workspaceId,
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(name = "status", required = false) String status,
            @RequestParam(name = "workflowId", required = false) UUID workflowId,
            @RequestParam(name = "from", required = false) String from,
            @RequestParam(name = "to", required = false) String to,
            @RequestParam(name = "page", defaultValue = "0") @Min(0) int page,
            @RequestParam(name = "size", defaultValue = "20") @Min(1) @Max(100) int size) {
        return MonitoringResponse.RunPage.from(monitoringService.history(workspaceId, actorId(jwt),
                parseStatus(status), workflowId, parseInstant(from, "from"), parseInstant(to, "to"), page, size));
    }

    @GetMapping("/monitoring/summary")
    public MonitoringResponse.Summary summary(
            @PathVariable UUID workspaceId,
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(name = "days", defaultValue = "7") int days) {
        return MonitoringResponse.Summary.from(monitoringService.summary(workspaceId, actorId(jwt), days));
    }

    @GetMapping("/alert-rules")
    public MonitoringResponse.RuleList listRules(@PathVariable UUID workspaceId, @AuthenticationPrincipal Jwt jwt) {
        return MonitoringResponse.RuleList.from(alertRuleService.list(workspaceId, actorId(jwt)));
    }

    @PostMapping("/alert-rules")
    public ResponseEntity<MonitoringResponse.Rule> createRule(
            @PathVariable UUID workspaceId,
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody AlertRuleRequest request) {
        MonitoringResponse.Rule rule = MonitoringResponse.Rule.from(
                alertRuleService.create(workspaceId, actorId(jwt), request.toInput()));
        return ResponseEntity.created(URI.create("/workspaces/" + workspaceId + "/alert-rules/" + rule.id()))
                .body(rule);
    }

    @PutMapping("/alert-rules/{ruleId}")
    public MonitoringResponse.Rule updateRule(
            @PathVariable UUID workspaceId,
            @PathVariable UUID ruleId,
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody AlertRuleRequest request) {
        return MonitoringResponse.Rule.from(
                alertRuleService.update(workspaceId, actorId(jwt), ruleId, request.toInput()));
    }

    @DeleteMapping("/alert-rules/{ruleId}")
    public ResponseEntity<Void> deleteRule(
            @PathVariable UUID workspaceId, @PathVariable UUID ruleId, @AuthenticationPrincipal Jwt jwt) {
        alertRuleService.delete(workspaceId, actorId(jwt), ruleId);
        return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
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

    private static UUID actorId(Jwt jwt) {
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (RuntimeException exception) {
            throw new BadRequestException("The authenticated principal is invalid");
        }
    }
}
