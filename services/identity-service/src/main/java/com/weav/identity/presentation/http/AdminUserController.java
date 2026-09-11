package com.weav.identity.presentation.http;

import com.weav.identity.application.usecase.ChangeUserStatusUseCase;
import com.weav.identity.application.usecase.GetUserDetailUseCase;
import com.weav.identity.application.usecase.ListUsersUseCase;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.presentation.http.mapper.AdminUserPresentationMapper;
import com.weav.identity.presentation.http.request.ChangeUserStatusRequest;
import com.weav.identity.presentation.http.response.AdminUserPageResponse;
import com.weav.identity.presentation.http.response.AdminUserResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/admin/users")
public class AdminUserController {

    private final ListUsersUseCase listUsersUseCase;
    private final GetUserDetailUseCase getUserDetailUseCase;
    private final ChangeUserStatusUseCase changeUserStatusUseCase;
    private final AdminUserPresentationMapper mapper;

    public AdminUserController(
            ListUsersUseCase listUsersUseCase,
            GetUserDetailUseCase getUserDetailUseCase,
            ChangeUserStatusUseCase changeUserStatusUseCase,
            AdminUserPresentationMapper mapper
    ) {
        this.listUsersUseCase = listUsersUseCase;
        this.getUserDetailUseCase = getUserDetailUseCase;
        this.changeUserStatusUseCase = changeUserStatusUseCase;
        this.mapper = mapper;
    }

    @GetMapping
    public AdminUserPageResponse listUsers(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) UserStatus status
    ) {
        UUID actorId = UUID.fromString(jwt.getSubject());
        UUID sessionId = UUID.fromString(jwt.getClaimAsString("sid"));
        return mapper.toResponse(listUsersUseCase.execute(actorId, sessionId, search, status, page, size));
    }

    @GetMapping("/{userId}")
    public AdminUserResponse getUser(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID userId
    ) {
        UUID actorId = UUID.fromString(jwt.getSubject());
        UUID sessionId = UUID.fromString(jwt.getClaimAsString("sid"));
        return mapper.toResponse(getUserDetailUseCase.execute(actorId, sessionId, userId));
    }

    @PatchMapping("/{userId}/status")
    public AdminUserResponse changeStatus(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID userId,
            @Valid @RequestBody ChangeUserStatusRequest request,
            @RequestHeader(value = "X-Correlation-Id", required = false) String correlationId
    ) {
        UUID actorId = UUID.fromString(jwt.getSubject());
        UUID sessionId = UUID.fromString(jwt.getClaimAsString("sid"));
        return mapper.toResponse(changeUserStatusUseCase.execute(
                actorId,
                sessionId,
                userId,
                request.status(),
                correlationId));
    }
}
