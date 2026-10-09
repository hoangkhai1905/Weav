package com.weav.workflow.presentation.http;

import com.weav.workflow.application.port.out.TemplateStore;
import com.weav.workflow.application.service.TemplateService;
import com.weav.workflow.application.service.TemplateService.Caller;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.presentation.http.request.TemplateRequests.PatchTemplateRequest;
import com.weav.workflow.presentation.http.request.TemplateRequests.ShareTemplateRequest;
import com.weav.workflow.presentation.http.request.TemplateRequests.UseTemplateRequest;
import com.weav.workflow.presentation.http.response.TemplateResponse;
import jakarta.validation.Validator;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.UUID;

/** Shared workflow templates (W6-C): share a workflow, browse the gallery, copy a template into a workspace. */
@RestController
public class TemplateController {
    private final TemplateService templates;
    private final ObjectMapper objectMapper;
    private final Validator validator;

    public TemplateController(TemplateService templates, ObjectMapper objectMapper, Validator validator) {
        this.templates = templates;
        this.objectMapper = objectMapper;
        this.validator = validator;
    }

    /** Template bodies are small (name, description, visibility); anything bigger is not a template request. */
    static final int MAX_BODY_BYTES = 16 * 1024;

    /**
     * Parses a body strictly (unknown fields, duplicate keys and trailing content are errors, unlike the Boot
     * default), caps its size, and runs bean validation.
     */
    private <T> T read(String body, Class<T> type) {
        if (body == null || body.length() > MAX_BODY_BYTES
                || body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_BODY_BYTES) {
            throw new BadRequestException("Request body is missing or too large");
        }
        T value;
        try {
            value = objectMapper.readerFor(type)
                    .with(tools.jackson.core.StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .readValue(body);
        } catch (RuntimeException exception) {
            throw new BadRequestException("Request body is malformed");
        }
        if (value == null) {
            throw new BadRequestException("Request body is malformed");
        }
        validator.validate(value).stream().findFirst().ifPresent(violation -> {
            throw new BadRequestException(violation.getMessage());
        });
        return value;
    }

    @PostMapping("/workspaces/{workspaceId}/workflows/{workflowId}/template/preview")
    public TemplateResponse.Preview preview(
            @PathVariable UUID workspaceId, @PathVariable UUID workflowId, @AuthenticationPrincipal Jwt jwt) {
        UUID actor = userId(jwt);
        return TemplateResponse.Preview.from(templates.preview(workspaceId, workflowId, actor), actor);
    }

    @PutMapping("/workspaces/{workspaceId}/workflows/{workflowId}/template")
    public ResponseEntity<TemplateResponse.Detail> share(
            @PathVariable UUID workspaceId,
            @PathVariable UUID workflowId,
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody String body) {
        ShareTemplateRequest request = read(body, ShareTemplateRequest.class);
        UUID actor = userId(jwt);
        TemplateService.Upserted result = templates.share(workspaceId, workflowId, actor,
                new TemplateService.ShareInput(request.name(), request.description(), request.authorName(),
                        request.visibility()));
        TemplateResponse.Detail detail = TemplateResponse.Detail.from(result.template(), actor);
        return result.created()
                ? ResponseEntity.created(URI.create("/templates/" + detail.id())).body(detail)
                : ResponseEntity.ok(detail);
    }

    @GetMapping("/templates")
    public TemplateResponse.Page list(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(name = "scope", defaultValue = "public") String scope,
            @RequestParam(name = "workspaceId", required = false) UUID workspaceId,
            @RequestParam(name = "q", required = false) String q,
            @RequestParam(name = "page", defaultValue = "0") @Min(0) int page,
            @RequestParam(name = "size", defaultValue = "20") @Min(1) @Max(100) int size) {
        Caller caller = caller(jwt);
        return TemplateResponse.Page.from(
                templates.list(parseScope(scope), workspaceId, q, page, size, caller), caller.userId());
    }

    @GetMapping("/templates/by-code/{code}")
    public TemplateResponse.Detail byCode(@PathVariable String code, @AuthenticationPrincipal Jwt jwt) {
        Caller caller = caller(jwt);
        return TemplateResponse.Detail.from(templates.getByCode(code, caller), caller.userId());
    }

    @GetMapping("/templates/{id}")
    public TemplateResponse.Detail get(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        Caller caller = caller(jwt);
        return TemplateResponse.Detail.from(templates.get(id, caller), caller.userId());
    }

    @PatchMapping("/templates/{id}")
    public TemplateResponse.Detail patch(
            @PathVariable UUID id, @AuthenticationPrincipal Jwt jwt, @RequestBody String body) {
        PatchTemplateRequest request = read(body, PatchTemplateRequest.class);
        Caller caller = caller(jwt);
        return TemplateResponse.Detail.from(templates.update(id, caller,
                new TemplateService.PatchInput(request.name(), request.description(), request.visibility())),
                caller.userId());
    }

    @DeleteMapping("/templates/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        templates.delete(id, caller(jwt));
        return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
    }

    @PostMapping("/templates/{id}/use")
    public ResponseEntity<TemplateResponse.Used> use(
            @PathVariable UUID id, @AuthenticationPrincipal Jwt jwt, @RequestBody String body) {
        UseTemplateRequest request = read(body, UseTemplateRequest.class);
        UUID workflowId = templates.use(id, caller(jwt), request.workspaceId(), request.name());
        return ResponseEntity.status(HttpStatus.CREATED).body(new TemplateResponse.Used(workflowId));
    }

    private static TemplateStore.Scope parseScope(String scope) {
        return switch (scope) {
            case "public" -> TemplateStore.Scope.PUBLIC;
            case "workspace" -> TemplateStore.Scope.WORKSPACE;
            case "mine" -> TemplateStore.Scope.MINE;
            default -> throw new BadRequestException("scope must be public, workspace or mine");
        };
    }

    private static Caller caller(Jwt jwt) {
        return new Caller(userId(jwt), "ADMIN".equals(jwt.getClaimAsString("system_role")));
    }

    private static UUID userId(Jwt jwt) {
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (RuntimeException exception) {
            throw new BadRequestException("The authenticated principal is invalid");
        }
    }
}
