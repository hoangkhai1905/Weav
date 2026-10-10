package com.weav.workspace.presentation.http;

import com.weav.workspace.application.dto.OwnerInvitationView;
import com.weav.workspace.application.usecase.CreateInvitationUseCase;
import com.weav.workspace.application.usecase.ListWorkspaceInvitationsUseCase;
import com.weav.workspace.application.usecase.ResendInvitationUseCase;
import com.weav.workspace.application.usecase.RevokeInvitationUseCase;
import com.weav.workspace.infrastructure.security.JwtActor;
import com.weav.workspace.presentation.http.request.CreateInvitationRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Owner-side invitation management (W7-A1). */
@RestController
@RequestMapping("/workspaces/{workspaceId}/invitations")
public final class InvitationController {

    private final CreateInvitationUseCase create;
    private final ListWorkspaceInvitationsUseCase list;
    private final RevokeInvitationUseCase revoke;
    private final ResendInvitationUseCase resend;

    public InvitationController(
            CreateInvitationUseCase create,
            ListWorkspaceInvitationsUseCase list,
            RevokeInvitationUseCase revoke,
            ResendInvitationUseCase resend) {
        this.create = create;
        this.list = list;
        this.revoke = revoke;
        this.resend = resend;
    }

    @PostMapping
    public ResponseEntity<OwnerInvitationView> create(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID workspaceId,
            @Valid @RequestBody CreateInvitationRequest request) {
        OwnerInvitationView view = create.execute(workspaceId, JwtActor.userId(jwt), request.email());
        return ResponseEntity.status(HttpStatus.CREATED).body(view);
    }

    @GetMapping
    public Map<String, List<OwnerInvitationView>> list(
            @AuthenticationPrincipal Jwt jwt, @PathVariable UUID workspaceId) {
        return Map.of("items", list.execute(workspaceId, JwtActor.userId(jwt)));
    }

    @DeleteMapping("/{invitationId}")
    public ResponseEntity<Void> revoke(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID workspaceId,
            @PathVariable UUID invitationId) {
        revoke.execute(workspaceId, JwtActor.userId(jwt), invitationId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{invitationId}/resend")
    public OwnerInvitationView resend(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID workspaceId,
            @PathVariable UUID invitationId) {
        return resend.execute(workspaceId, JwtActor.userId(jwt), invitationId);
    }
}
