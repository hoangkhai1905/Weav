package com.weav.identity.presentation.http;

import com.weav.identity.application.dto.OtpVerificationResult;
import com.weav.identity.application.dto.RequestOtpCommand;
import com.weav.identity.application.dto.VerifyOtpCommand;
import com.weav.identity.application.port.out.OtpChallengeStore;
import com.weav.identity.application.usecase.RequestOtpUseCase;
import com.weav.identity.application.usecase.VerifyOtpUseCase;
import com.weav.identity.domain.exception.BadRequestException;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.presentation.http.request.OtpRequest;
import com.weav.identity.presentation.http.request.VerifyOtpRequest;
import com.weav.identity.presentation.http.response.EmailVerificationResponse;
import com.weav.identity.presentation.http.response.OtpReceiptResponse;
import com.weav.identity.presentation.http.response.PasswordResetVerificationResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
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
@RequestMapping("/auth/otp")
public final class OtpController {

    private final RequestOtpUseCase requestOtpUseCase;
    private final VerifyOtpUseCase verifyOtpUseCase;

    public OtpController(RequestOtpUseCase requestOtpUseCase, VerifyOtpUseCase verifyOtpUseCase) {
        this.requestOtpUseCase = requestOtpUseCase;
        this.verifyOtpUseCase = verifyOtpUseCase;
    }

    @PostMapping("/request")
    public ResponseEntity<OtpReceiptResponse> request(
            @Valid @RequestBody OtpRequest request,
            @AuthenticationPrincipal Jwt jwt,
            HttpServletRequest httpRequest
    ) {
        validateEmailPresence(request);
        UUID userId = optionalUuidClaim(jwt, "sub");
        UUID sessionId = optionalUuidClaim(jwt, "sid");
        var receipt = requestOtpUseCase.execute(new RequestOtpCommand(
                request.purpose(),
                request.email(),
                userId,
                sessionId,
                httpRequest.getRemoteAddr()
        ));
        return ResponseEntity.accepted()
                .cacheControl(CacheControl.noStore())
                .body(OtpReceiptResponse.from(receipt));
    }

    @PostMapping("/verify")
    public ResponseEntity<Object> verify(
            @Valid @RequestBody VerifyOtpRequest request,
            @AuthenticationPrincipal Jwt jwt,
            HttpServletRequest httpRequest
    ) {
        UUID userId = optionalUuidClaim(jwt, "sub");
        UUID sessionId = optionalUuidClaim(jwt, "sid");
        OtpVerificationResult result = verifyOtpUseCase.execute(new VerifyOtpCommand(
                request.challengeId(),
                request.code(),
                userId,
                sessionId,
                httpRequest.getRemoteAddr()
        ));
        Object response = result.purpose() == OtpChallengeStore.Purpose.EMAIL_VERIFICATION
                ? new EmailVerificationResponse()
                : new PasswordResetVerificationResponse(result.resetToken(), result.expiresIn());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    private static void validateEmailPresence(OtpRequest request) {
        if (request.purpose() == OtpChallengeStore.Purpose.EMAIL_VERIFICATION && request.hasEmail()) {
            throw new BadRequestException("Email must not be supplied for email verification");
        }
        if (request.purpose() == OtpChallengeStore.Purpose.PASSWORD_RESET
                && (!request.hasEmail() || request.email() == null)) {
            throw new BadRequestException("Email is required");
        }
    }

    private static UUID optionalUuidClaim(Jwt jwt, String claim) {
        if (jwt == null) return null;
        String value = "sub".equals(claim) ? jwt.getSubject() : jwt.getClaimAsString(claim);
        if (value == null || value.isBlank()) {
            throw new UnauthorizedException("Authentication failed");
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException exception) {
            throw new UnauthorizedException("Authentication failed");
        }
    }
}
