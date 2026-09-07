package com.weav.identity.presentation.http;

import com.weav.identity.application.dto.ChangePasswordCommand;
import com.weav.identity.application.usecase.ChangePasswordUseCase;
import com.weav.identity.presentation.http.request.ChangePasswordRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/auth")
public class PasswordController {

    private final ChangePasswordUseCase changePasswordUseCase;

    public PasswordController(ChangePasswordUseCase changePasswordUseCase) {
        this.changePasswordUseCase = changePasswordUseCase;
    }

    @PostMapping("/change-password")
    public ResponseEntity<Void> changePassword(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody ChangePasswordRequest request
    ) {
        changePasswordUseCase.execute(
                UUID.fromString(jwt.getSubject()),
                UUID.fromString(jwt.getClaimAsString("sid")),
                new ChangePasswordCommand(request.currentPassword(), request.newPassword())
        );
        return ResponseEntity.noContent().build();
    }
}
