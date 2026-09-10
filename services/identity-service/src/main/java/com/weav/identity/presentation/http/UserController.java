package com.weav.identity.presentation.http;

import com.weav.identity.application.usecase.GetCurrentUserUseCase;
import com.weav.identity.application.usecase.UpdateProfileUseCase;
import com.weav.identity.domain.exception.BadRequestException;
import com.weav.identity.presentation.http.mapper.UserPresentationMapper;
import com.weav.identity.presentation.http.request.UpdateProfileRequest;
import com.weav.identity.presentation.http.response.UserResponse;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/users")
public class UserController {

    private final GetCurrentUserUseCase getCurrentUserUseCase;
    private final UpdateProfileUseCase updateProfileUseCase;
    private final UserPresentationMapper mapper;

    public UserController(
            GetCurrentUserUseCase getCurrentUserUseCase,
            UpdateProfileUseCase updateProfileUseCase,
            UserPresentationMapper mapper
    ) {
        this.getCurrentUserUseCase = getCurrentUserUseCase;
        this.updateProfileUseCase = updateProfileUseCase;
        this.mapper = mapper;
    }

    @GetMapping("/me")
    public UserResponse currentUser(@AuthenticationPrincipal Jwt jwt) {
        UUID userId = UUID.fromString(jwt.getSubject());
        UUID sessionId = UUID.fromString(jwt.getClaimAsString("sid"));
        return mapper.toResponse(getCurrentUserUseCase.execute(userId, sessionId));
    }

    @PatchMapping("/me")
    public UserResponse updateCurrentUser(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody UpdateProfileRequest request
    ) {
        if (!request.hasDisplayName()) {
            throw new BadRequestException("displayName is required");
        }
        UUID userId = UUID.fromString(jwt.getSubject());
        UUID sessionId = UUID.fromString(jwt.getClaimAsString("sid"));
        return mapper.toResponse(
                updateProfileUseCase.execute(userId, sessionId, mapper.toCommand(request))
        );
    }
}
