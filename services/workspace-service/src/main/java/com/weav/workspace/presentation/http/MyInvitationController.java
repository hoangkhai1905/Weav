package com.weav.workspace.presentation.http;

import com.weav.workspace.application.dto.MyInvitationsView;
import com.weav.workspace.application.usecase.AcceptInvitationUseCase;
import com.weav.workspace.application.usecase.DeclineInvitationUseCase;
import com.weav.workspace.application.usecase.ListMyInvitationsUseCase;
import com.weav.workspace.infrastructure.security.JwtActor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

/**
 * Invitee-side routes (W7-A1). The literal path {@code /workspaces/invitations} wins over
 * {@code /workspaces/{workspaceId}} in Spring's path matching.
 */
@RestController
@RequestMapping("/workspaces/invitations")
public final class MyInvitationController {

    private final ListMyInvitationsUseCase list;
    private final AcceptInvitationUseCase accept;
    private final DeclineInvitationUseCase decline;

    public MyInvitationController(
            ListMyInvitationsUseCase list, AcceptInvitationUseCase accept, DeclineInvitationUseCase decline) {
        this.list = list;
        this.accept = accept;
        this.decline = decline;
    }

    @GetMapping
    public MyInvitationsView list(@AuthenticationPrincipal Jwt jwt) {
        return list.execute(JwtActor.userId(jwt));
    }

    @PostMapping("/{invitationId}/accept")
    public Map<String, UUID> accept(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID invitationId) {
        return Map.of("workspaceId", accept.execute(JwtActor.userId(jwt), invitationId));
    }

    @PostMapping("/{invitationId}/decline")
    public ResponseEntity<Void> decline(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID invitationId) {
        decline.execute(JwtActor.userId(jwt), invitationId);
        return ResponseEntity.noContent().build();
    }
}
