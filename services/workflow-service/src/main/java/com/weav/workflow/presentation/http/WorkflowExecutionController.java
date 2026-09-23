package com.weav.workflow.presentation.http;

import com.weav.workflow.application.port.out.ExecutionQueryPort;
import com.weav.workflow.application.service.ExecutionQueryService;
import com.weav.workflow.application.usecase.TriggerExecutionUseCase;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.infrastructure.web.CorrelationIdFilter;
import com.weav.workflow.presentation.http.request.ManualExecutionRequest;
import com.weav.workflow.presentation.http.response.ExecutionResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/workspaces/{workspaceId}/workflows/{workflowId}/executions")
public final class WorkflowExecutionController {
    private final TriggerExecutionUseCase triggerExecutionUseCase;
    private final ExecutionQueryService queryService;

    public WorkflowExecutionController(TriggerExecutionUseCase triggerExecutionUseCase,
                                       ExecutionQueryService queryService) {
        this.triggerExecutionUseCase = triggerExecutionUseCase;
        this.queryService = queryService;
    }

    @PostMapping
    public ResponseEntity<ExecutionResponse.Accepted> manual(
            @PathVariable UUID workspaceId,
            @PathVariable UUID workflowId,
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody ManualExecutionRequest request,
            HttpServletRequest servletRequest,
            @RequestHeader(value = "traceparent", required = false) String traceparent) {
        UUID actorId = actorId(jwt);
        var result = triggerExecutionUseCase.manual(
                workspaceId, workflowId, actorId, request.input(),
                CorrelationIdFilter.requestId(servletRequest), traceparent);
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(ExecutionResponse.Accepted.from(result));
    }

    @GetMapping
    public ExecutionResponse.Page list(
            @PathVariable UUID workspaceId,
            @PathVariable UUID workflowId,
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(name = "page", defaultValue = "0") @Min(0) int page,
            @RequestParam(name = "size", defaultValue = "20") @Min(1) @Max(100) int size) {
        ExecutionQueryPort.ExecutionPage result = queryService.list(
                workspaceId, workflowId, actorId(jwt), page, size);
        return ExecutionResponse.Page.from(result);
    }

    @GetMapping("/{executionId}")
    public ExecutionResponse.Detail detail(
            @PathVariable UUID workspaceId,
            @PathVariable UUID workflowId,
            @PathVariable UUID executionId,
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(name = "logPage", defaultValue = "0") @Min(0) int logPage,
            @RequestParam(name = "logSize", defaultValue = "20") @Min(1) @Max(100) int logSize) {
        ExecutionQueryPort.ExecutionDetail result = queryService.detail(
                workspaceId, workflowId, executionId, actorId(jwt), logPage, logSize);
        return ExecutionResponse.Detail.from(result);
    }

    private UUID actorId(Jwt jwt) {
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (RuntimeException exception) {
            throw new BadRequestException("The authenticated principal is invalid");
        }
    }
}
