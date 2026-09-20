package com.weav.workspace.presentation.http;

import com.weav.workspace.application.usecase.AuthorizeConnectionAttachmentUseCase;
import com.weav.workspace.application.usecase.ReportConnectionAuthFailureUseCase;
import com.weav.workspace.application.usecase.ResolveConnectionUseCase;
import com.weav.workspace.presentation.http.request.AuthorizeConnectionAttachmentRequest;
import com.weav.workspace.presentation.http.request.ReportConnectionAuthFailureRequest;
import com.weav.workspace.presentation.http.response.ResolvedConnectionHttpResponse;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** Internal Workflow-facing Connection adapter; the service-key filter owns authentication. */
@RestController
@RequestMapping("/internal/workspaces/{workspaceId}/connections/{connectionId}")
public final class InternalConnectionController {

    private final AuthorizeConnectionAttachmentUseCase authorizeAttachment;
    private final ResolveConnectionUseCase resolveConnection;
    private final ReportConnectionAuthFailureUseCase reportAuthFailure;

    public InternalConnectionController(
            AuthorizeConnectionAttachmentUseCase authorizeAttachment,
            ResolveConnectionUseCase resolveConnection,
            ReportConnectionAuthFailureUseCase reportAuthFailure) {
        this.authorizeAttachment = authorizeAttachment;
        this.resolveConnection = resolveConnection;
        this.reportAuthFailure = reportAuthFailure;
    }

    @PostMapping("/authorize-attachment")
    public ResponseEntity<Void> authorizeAttachment(
            @PathVariable UUID workspaceId,
            @PathVariable UUID connectionId,
            @Valid @RequestBody AuthorizeConnectionAttachmentRequest request) {
        authorizeAttachment.execute(request.userId(), workspaceId, connectionId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/resolve")
    public ResponseEntity<ResolvedConnectionHttpResponse> resolve(
            @PathVariable UUID workspaceId,
            @PathVariable UUID connectionId) {
        ResolvedConnectionHttpResponse response = ResolvedConnectionHttpResponse.from(
                resolveConnection.execute(workspaceId, connectionId));
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    @PostMapping("/auth-failure")
    public ResponseEntity<Void> reportAuthFailure(
            @PathVariable UUID workspaceId,
            @PathVariable UUID connectionId,
            @Valid @RequestBody ReportConnectionAuthFailureRequest request) {
        reportAuthFailure.execute(workspaceId, connectionId, request.failureCode());
        return ResponseEntity.noContent().build();
    }
}
