package com.weav.workflow.presentation.http;

import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.port.out.ConnectionReferenceUnavailableException;
import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.application.service.WorkflowDraftValidationException;
import com.weav.workflow.application.service.DraftChangedException;
import com.weav.workflow.application.service.TriggerDependencyUnavailableException;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.definition.DefinitionValidator;
import com.weav.workflow.domain.definition.ValidationIssue;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.infrastructure.definition.DefinitionJsonCodec;
import com.weav.workflow.infrastructure.web.ApiErrorResponse;
import com.weav.workflow.infrastructure.web.CorrelationIdFilter;
import com.weav.workflow.presentation.http.request.CreateWorkflowRequest;
import com.weav.workflow.presentation.http.request.SaveWorkflowDraftRequest;
import com.weav.workflow.presentation.http.response.WorkflowResponse;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/workspaces/{workspaceId}/workflows")
public class WorkflowController {

    private final WorkflowDraftService workflowDraftService;
    private final WorkflowPublicationService workflowPublicationService;
    private final DefinitionJsonCodec definitionCodec;
    private final ObjectMapper objectMapper;

    public WorkflowController(
            WorkflowDraftService workflowDraftService,
            WorkflowPublicationService workflowPublicationService,
            ObjectMapper objectMapper) {
        this.workflowDraftService = workflowDraftService;
        this.workflowPublicationService = workflowPublicationService;
        this.objectMapper = objectMapper;
        this.definitionCodec = new DefinitionJsonCodec(objectMapper);
    }

    @PostMapping
    public ResponseEntity<WorkflowResponse.Created> create(
            @PathVariable UUID workspaceId,
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateWorkflowRequest request) {
        enforceBodySize(request);
        Workflow workflow = workflowDraftService.create(new CreateWorkflowCommand(
                workspaceId, actorId(jwt), request.name(), request.description()));
        return ResponseEntity.created(URI.create("/workspaces/" + workspaceId + "/workflows/" + workflow.getId()))
                .body(WorkflowResponse.Created.from(workflow));
    }

    @GetMapping
    public WorkflowResponse.Page list(
            @PathVariable UUID workspaceId,
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return WorkflowResponse.Page.from(workflowDraftService.list(workspaceId, actorId(jwt), page, size));
    }

    @GetMapping("/{workflowId}")
    public WorkflowResponse get(
            @PathVariable UUID workspaceId,
            @PathVariable UUID workflowId,
            @AuthenticationPrincipal Jwt jwt) {
        Workflow workflow = workflowDraftService.get(workspaceId, workflowId, actorId(jwt));
        return WorkflowResponse.from(workflow,
                workflowPublicationService.currentTriggers(workflowId, workflow.getCurrentVersionId()));
    }

    @PutMapping("/{workflowId}/draft")
    public WorkflowResponse saveDraft(
            @PathVariable UUID workspaceId,
            @PathVariable UUID workflowId,
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody SaveWorkflowDraftRequest request) {
        enforceBodySize(request);
        WorkflowDefinition definition = decodeDefinition(request);
        return WorkflowResponse.from(workflowDraftService.save(workspaceId, workflowId, actorId(jwt),
                request.name(), request.description(), definition, request.editorState()));
    }

    @PostMapping("/{workflowId}/publish")
    public ResponseEntity<WorkflowResponse.Publication> publish(
            @PathVariable UUID workspaceId,
            @PathVariable UUID workflowId,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .header("Cache-Control", "no-store")
                .body(WorkflowResponse.Publication.from(
                        workflowPublicationService.publish(workspaceId, workflowId, actorId(jwt))));
    }

    @PostMapping("/{workflowId}/pause")
    public WorkflowResponse pause(
            @PathVariable UUID workspaceId,
            @PathVariable UUID workflowId,
            @AuthenticationPrincipal Jwt jwt) {
        return WorkflowResponse.from(workflowPublicationService.pause(workspaceId, workflowId, actorId(jwt)));
    }

    @PostMapping("/{workflowId}/resume")
    public WorkflowResponse resume(
            @PathVariable UUID workspaceId,
            @PathVariable UUID workflowId,
            @AuthenticationPrincipal Jwt jwt) {
        return WorkflowResponse.from(workflowPublicationService.resume(workspaceId, workflowId, actorId(jwt)));
    }

    private WorkflowDefinition decodeDefinition(SaveWorkflowDraftRequest request) {
        try {
            return definitionCodec.decode(request.definition());
        } catch (IllegalArgumentException exception) {
            throw new BadRequestException("Workflow definition is malformed");
        }
    }

    @org.springframework.web.bind.annotation.ExceptionHandler(WorkflowDraftValidationException.class)
    public ResponseEntity<ApiErrorResponse> handleInvalidDraft(
            WorkflowDraftValidationException exception,
            HttpServletRequest request) {
        List<ApiErrorResponse.ErrorDetail> details = exception.issues().stream()
                .limit(100)
                .map(this::safeDetail)
                .toList();
        return errorResponse(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
                "Workflow definition is invalid", details, request);
    }

    @org.springframework.web.bind.annotation.ExceptionHandler(ConnectionReferenceUnavailableException.class)
    public ResponseEntity<ApiErrorResponse> handleReferenceProtectionUnavailable(
            ConnectionReferenceUnavailableException exception,
            HttpServletRequest request) {
        return errorResponse(HttpStatus.SERVICE_UNAVAILABLE, "DEPENDENCY_UNAVAILABLE",
                "Workflow connection reference protection is unavailable", List.of(), request);
    }

    @org.springframework.web.bind.annotation.ExceptionHandler(DraftChangedException.class)
    public ResponseEntity<ApiErrorResponse> handleDraftChanged(
            DraftChangedException exception,
            HttpServletRequest request) {
        return errorResponse(HttpStatus.CONFLICT, "DRAFT_CHANGED",
                "Workflow draft changed while publishing", List.of(), request);
    }

    @org.springframework.web.bind.annotation.ExceptionHandler(TriggerDependencyUnavailableException.class)
    public ResponseEntity<ApiErrorResponse> handleTriggerDependencyUnavailable(
            TriggerDependencyUnavailableException exception,
            HttpServletRequest request) {
        return errorResponse(HttpStatus.SERVICE_UNAVAILABLE, "DEPENDENCY_UNAVAILABLE",
                "Workflow trigger configuration is not available", List.of(), request);
    }

    private ApiErrorResponse.ErrorDetail safeDetail(ValidationIssue issue) {
        String field = issue.nodeId() == null
                ? issue.field()
                : "nodes[" + issue.nodeId() + "]." + issue.field();
        return new ApiErrorResponse.ErrorDetail(field, issue.code() + ": " + issue.message());
    }

    private ResponseEntity<ApiErrorResponse> errorResponse(
            HttpStatus status,
            String code,
            String message,
            List<ApiErrorResponse.ErrorDetail> details,
            HttpServletRequest request) {
        String correlationId = CorrelationIdFilter.requestId(request);
        return ResponseEntity.status(status)
                .header(CorrelationIdFilter.HEADER_NAME, correlationId)
                .body(ApiErrorResponse.of(code, message, status.value(), request.getRequestURI(), details));
    }

    private void enforceBodySize(Object request) {
        try {
            if (objectMapper.writeValueAsBytes(request).length > DefinitionValidator.MAX_DEFINITION_BYTES) {
                throw new BadRequestException("Request body exceeds the supported size");
            }
        } catch (BadRequestException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new BadRequestException("Request body could not be validated");
        }
    }

    private UUID actorId(Jwt jwt) {
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (IllegalArgumentException exception) {
            throw new BadRequestException("The authenticated principal is invalid");
        }
    }
}
