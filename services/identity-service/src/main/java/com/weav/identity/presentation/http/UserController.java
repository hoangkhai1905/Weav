package com.weav.identity.presentation.http;

import com.weav.identity.application.usecase.GetCurrentUserUseCase;
import com.weav.identity.presentation.http.mapper.UserPresentationMapper;
import com.weav.identity.presentation.http.response.UserResponse;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/users")
public class UserController {

    private final GetCurrentUserUseCase getCurrentUserUseCase;
    private final UserPresentationMapper mapper;

    public UserController(GetCurrentUserUseCase getCurrentUserUseCase, UserPresentationMapper mapper) {
        this.getCurrentUserUseCase = getCurrentUserUseCase;
        this.mapper = mapper;
    }

    @GetMapping("/me")
    public UserResponse currentUser(@AuthenticationPrincipal Jwt jwt) {
        UUID userId = UUID.fromString(jwt.getSubject());
        UUID sessionId = UUID.fromString(jwt.getClaimAsString("sid"));
        return mapper.toResponse(getCurrentUserUseCase.execute(userId, sessionId));
    }
}
