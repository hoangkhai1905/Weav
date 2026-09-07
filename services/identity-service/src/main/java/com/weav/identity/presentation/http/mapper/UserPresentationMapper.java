package com.weav.identity.presentation.http.mapper;

import com.weav.identity.application.dto.AuthenticatedUserResult;
import com.weav.identity.application.dto.LoginCommand;
import com.weav.identity.application.dto.RefreshTokenCommand;
import com.weav.identity.application.dto.RegisterUserCommand;
import com.weav.identity.application.dto.SessionPageResult;
import com.weav.identity.application.dto.SessionResult;
import com.weav.identity.application.dto.TokenPairResult;
import com.weav.identity.application.dto.UpdateProfileCommand;
import com.weav.identity.presentation.http.request.LoginRequest;
import com.weav.identity.presentation.http.request.RefreshTokenRequest;
import com.weav.identity.presentation.http.request.RegisterUserRequest;
import com.weav.identity.presentation.http.request.UpdateProfileRequest;
import com.weav.identity.presentation.http.response.SessionPageResponse;
import com.weav.identity.presentation.http.response.SessionResponse;
import com.weav.identity.presentation.http.response.TokenResponse;
import com.weav.identity.presentation.http.response.UserResponse;
import org.springframework.stereotype.Component;

@Component
public class UserPresentationMapper {

    public RegisterUserCommand toCommand(RegisterUserRequest request) {
        return new RegisterUserCommand(request.email(), request.password(), request.displayName());
    }

    public LoginCommand toCommand(LoginRequest request, String userAgent, String ipAddress) {
        return new LoginCommand(request.email(), request.password(), userAgent, ipAddress);
    }

    public LoginCommand toCommand(LoginRequest request) {
        return new LoginCommand(request.email(), request.password());
    }

    public RefreshTokenCommand toCommand(RefreshTokenRequest request) {
        return new RefreshTokenCommand(request.refreshToken());
    }

    public UpdateProfileCommand toCommand(UpdateProfileRequest request) {
        return new UpdateProfileCommand(request.displayName());
    }

    public UserResponse toResponse(AuthenticatedUserResult user) {
        return new UserResponse(
                user.id(),
                user.email(),
                user.displayName(),
                user.avatarStorageKey(),
                user.systemRole(),
                user.status(),
                user.createdAt(),
                user.updatedAt()
        );
    }

    public TokenResponse toResponse(TokenPairResult result) {
        return new TokenResponse(
                result.accessToken(),
                result.refreshToken(),
                result.tokenType(),
                result.expiresIn(),
                result.refreshExpiresAt(),
                toResponse(result.user())
        );
    }

    public SessionResponse toSessionResponse(SessionResult session) {
        return new SessionResponse(
                session.id(),
                session.createdAt(),
                session.lastUsedAt(),
                session.expiresAt(),
                session.current(),
                session.userAgent()
        );
    }

    public SessionPageResponse toSessionPageResponse(SessionPageResult page) {
        return new SessionPageResponse(
                page.items().stream().map(this::toSessionResponse).toList(),
                page.page(),
                page.size(),
                page.totalItems(),
                page.totalPages()
        );
    }
}
