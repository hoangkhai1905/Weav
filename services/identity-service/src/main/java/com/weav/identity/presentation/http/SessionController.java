package com.weav.identity.presentation.http;

import com.weav.identity.application.dto.SessionPageResult;
import com.weav.identity.application.usecase.ListSessionsUseCase;
import com.weav.identity.application.usecase.RevokeAllSessionsUseCase;
import com.weav.identity.application.usecase.RevokeSessionUseCase;
import com.weav.identity.domain.exception.ResourceNotFoundException;
import com.weav.identity.presentation.http.mapper.UserPresentationMapper;
import com.weav.identity.presentation.http.response.SessionPageResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/users/me/sessions")
public class SessionController {

    private final ListSessionsUseCase listSessionsUseCase;
    private final RevokeSessionUseCase revokeSessionUseCase;
    private final RevokeAllSessionsUseCase revokeAllSessionsUseCase;
    private final UserPresentationMapper mapper;

    public SessionController(
            ListSessionsUseCase listSessionsUseCase,
            RevokeSessionUseCase revokeSessionUseCase,
            RevokeAllSessionsUseCase revokeAllSessionsUseCase,
            UserPresentationMapper mapper
    ) {
        this.listSessionsUseCase = listSessionsUseCase;
        this.revokeSessionUseCase = revokeSessionUseCase;
        this.revokeAllSessionsUseCase = revokeAllSessionsUseCase;
        this.mapper = mapper;
    }

    @GetMapping
    public SessionPageResponse listSessions(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        UUID userId = UUID.fromString(jwt.getSubject());
        UUID sessionId = UUID.fromString(jwt.getClaimAsString("sid"));

        SessionPageResult result = listSessionsUseCase.execute(userId, sessionId, page, size);
        return mapper.toSessionPageResponse(result);
    }

    @DeleteMapping("/{sessionId}")
    public ResponseEntity<Void> revokeSession(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID sessionId
    ) {
        UUID userId = UUID.fromString(jwt.getSubject());
        UUID currentSessionId = UUID.fromString(jwt.getClaimAsString("sid"));
        revokeSessionUseCase.execute(userId, currentSessionId, sessionId);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping
    public ResponseEntity<Void> revokeAllSessions(@AuthenticationPrincipal Jwt jwt) {
        UUID userId = UUID.fromString(jwt.getSubject());
        UUID sessionId = UUID.fromString(jwt.getClaimAsString("sid"));
        revokeAllSessionsUseCase.execute(userId, sessionId);
        return ResponseEntity.noContent().build();
    }
}
