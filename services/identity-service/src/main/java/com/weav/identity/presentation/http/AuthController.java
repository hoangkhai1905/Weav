package com.weav.identity.presentation.http;

import com.weav.identity.application.usecase.LoginUseCase;
import com.weav.identity.application.usecase.LogoutUseCase;
import com.weav.identity.application.usecase.RefreshSessionUseCase;
import com.weav.identity.application.usecase.RegisterUserUseCase;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.infrastructure.security.AuthRateLimiter;
import com.weav.identity.presentation.http.mapper.UserPresentationMapper;
import com.weav.identity.presentation.http.request.LoginRequest;
import com.weav.identity.presentation.http.request.RefreshTokenRequest;
import com.weav.identity.presentation.http.request.RegisterUserRequest;
import com.weav.identity.presentation.http.response.TokenResponse;
import com.weav.identity.presentation.http.response.UserResponse;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final RegisterUserUseCase registerUserUseCase;
    private final LoginUseCase loginUseCase;
    private final RefreshSessionUseCase refreshSessionUseCase;
    private final LogoutUseCase logoutUseCase;
    private final AuthRateLimiter rateLimiter;
    private final AuthInputPolicy inputPolicy;
    private final UserPresentationMapper mapper;

    public AuthController(
            RegisterUserUseCase registerUserUseCase,
            LoginUseCase loginUseCase,
            RefreshSessionUseCase refreshSessionUseCase,
            LogoutUseCase logoutUseCase,
            AuthRateLimiter rateLimiter,
            AuthInputPolicy inputPolicy,
            UserPresentationMapper mapper
    ) {
        this.registerUserUseCase = registerUserUseCase;
        this.loginUseCase = loginUseCase;
        this.refreshSessionUseCase = refreshSessionUseCase;
        this.logoutUseCase = logoutUseCase;
        this.rateLimiter = rateLimiter;
        this.inputPolicy = inputPolicy;
        this.mapper = mapper;
    }

    @PostMapping("/register")
    public ResponseEntity<UserResponse> register(@Valid @RequestBody RegisterUserRequest request) {
        UserResponse response = mapper.toResponse(registerUserUseCase.execute(mapper.toCommand(request)));
        return ResponseEntity.created(URI.create("/users/" + response.id())).body(response);
    }

    @PostMapping("/login")
    public ResponseEntity<TokenResponse> login(@Valid @RequestBody LoginRequest request) {
        rateLimiter.requireAllowed(
                AuthRateLimiter.Scope.LOGIN_ACCOUNT,
                inputPolicy.canonicalizeEmail(request.email())
        );
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(mapper.toResponse(loginUseCase.execute(mapper.toCommand(request))));
    }

    @PostMapping("/refresh")
    public ResponseEntity<TokenResponse> refresh(@Valid @RequestBody RefreshTokenRequest request) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(mapper.toResponse(refreshSessionUseCase.execute(mapper.toCommand(request))));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@Valid @RequestBody RefreshTokenRequest request) {
        logoutUseCase.execute(mapper.toCommand(request));
        return ResponseEntity.noContent().build();
    }
}
