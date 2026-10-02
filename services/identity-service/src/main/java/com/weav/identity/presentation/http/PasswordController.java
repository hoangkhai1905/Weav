package com.weav.identity.presentation.http;

import com.weav.identity.application.dto.ChangePasswordCommand;
import com.weav.identity.application.dto.RequestOtpCommand;
import com.weav.identity.application.dto.ResetPasswordCommand;
import com.weav.identity.application.port.out.OtpChallengeStore;
import com.weav.identity.application.usecase.ChangePasswordUseCase;
import com.weav.identity.application.usecase.RequestOtpUseCase;
import com.weav.identity.application.usecase.ResetPasswordUseCase;
import com.weav.identity.presentation.http.request.ForgotPasswordRequest;
import com.weav.identity.presentation.http.request.ChangePasswordRequest;
import com.weav.identity.presentation.http.request.ResetPasswordRequest;
import com.weav.identity.presentation.http.response.OtpReceiptResponse;
import jakarta.validation.Valid;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
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
    private final RequestOtpUseCase requestOtpUseCase;
    private final ResetPasswordUseCase resetPasswordUseCase;

    public PasswordController(
            ChangePasswordUseCase changePasswordUseCase,
            RequestOtpUseCase requestOtpUseCase,
            ResetPasswordUseCase resetPasswordUseCase
    ) {
        this.changePasswordUseCase = changePasswordUseCase;
        this.requestOtpUseCase = requestOtpUseCase;
        this.resetPasswordUseCase = resetPasswordUseCase;
    }

    @PostMapping("/forgot-password")
    public ResponseEntity<OtpReceiptResponse> forgotPassword(
            @Valid @RequestBody ForgotPasswordRequest request,
            HttpServletRequest httpRequest
    ) {
        var receipt = requestOtpUseCase.execute(new RequestOtpCommand(
                OtpChallengeStore.Purpose.PASSWORD_RESET,
                request.email(),
                null,
                null,
                httpRequest.getRemoteAddr()
        ));
        return ResponseEntity.accepted()
                .cacheControl(CacheControl.noStore())
                .body(OtpReceiptResponse.from(receipt));
    }

    @PostMapping("/reset-password")
    public ResponseEntity<Void> resetPassword(@Valid @RequestBody ResetPasswordRequest request) {
        resetPasswordUseCase.execute(new ResetPasswordCommand(request.resetToken(), request.newPassword()));
        return ResponseEntity.noContent()
                .cacheControl(CacheControl.noStore())
                .build();
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
