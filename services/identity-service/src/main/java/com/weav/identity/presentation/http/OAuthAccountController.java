package com.weav.identity.presentation.http;

import com.weav.identity.application.dto.OAuthAccountMetadata;
import com.weav.identity.application.dto.OAuthStartResult;
import com.weav.identity.application.usecase.ListOAuthAccountsUseCase;
import com.weav.identity.application.usecase.LinkGoogleAccountUseCase;
import com.weav.identity.application.usecase.OAuthFlowCoordinator;
import com.weav.identity.application.usecase.UnlinkOAuthAccountUseCase;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.infrastructure.config.OAuthEnabledCondition;
import com.weav.identity.infrastructure.security.AuthRateLimiter;
import com.weav.identity.presentation.http.oauth.OAuthWebProtection;
import com.weav.identity.presentation.http.request.OAuthLinkStartRequest;
import com.weav.identity.presentation.http.request.OAuthUnlinkRequest;
import com.weav.identity.presentation.http.response.OAuthStartResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.context.annotation.Conditional;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/** Authenticated link, list and unlink endpoints for the current user's Google account. */
@RestController
@Conditional(OAuthEnabledCondition.class)
public final class OAuthAccountController {

    private static final String REFERRER_POLICY_HEADER = "Referrer-Policy";
    private static final String REFERRER_POLICY_VALUE = "no-referrer";

    private final OAuthFlowCoordinator coordinator;
    private final ListOAuthAccountsUseCase listUseCase;
    private final UnlinkOAuthAccountUseCase unlinkUseCase;
    private final OAuthWebProtection webProtection;
    private final AuthRateLimiter rateLimiter;

    public OAuthAccountController(
            OAuthFlowCoordinator coordinator,
            ListOAuthAccountsUseCase listUseCase,
            UnlinkOAuthAccountUseCase unlinkUseCase,
            OAuthWebProtection webProtection,
            AuthRateLimiter rateLimiter
    ) {
        this.coordinator = coordinator;
        this.listUseCase = listUseCase;
        this.unlinkUseCase = unlinkUseCase;
        this.webProtection = webProtection;
        this.rateLimiter = rateLimiter;
    }

    @PostMapping("/users/me/oauth/google/link")
    public ResponseEntity<OAuthStartResponse> startLink(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody OAuthLinkStartRequest request,
            HttpServletRequest httpRequest
    ) {
        webProtection.requireOriginAndCsrf(httpRequest);
        UUID userId = authenticatedUserId(jwt);
        UUID sessionId = authenticatedSessionId(jwt);
        rateLimiter.requireAllowed(AuthRateLimiter.Scope.OAUTH_LINK_START_SESSION, sessionId.toString());
        String csrfToken = webProtection.issueCsrfToken();
        OAuthStartResult result = coordinator.startLink(
                userId,
                sessionId,
                request.currentPassword(),
                request.toCommand());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(REFERRER_POLICY_HEADER, REFERRER_POLICY_VALUE)
                .header(HttpHeaders.SET_COOKIE, webProtection.correlationCookie(result.transactionId()).toString())
                .header(HttpHeaders.SET_COOKIE, webProtection.csrfCookie(csrfToken).toString())
                .body(new OAuthStartResponse(result.transactionId(), result.authorizationUrl(), csrfToken));
    }

    @GetMapping("/users/me/oauth-accounts")
    public ResponseEntity<List<OAuthAccountMetadata>> list(@AuthenticationPrincipal Jwt jwt) {
        UUID userId = authenticatedUserId(jwt);
        UUID sessionId = authenticatedSessionId(jwt);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(REFERRER_POLICY_HEADER, REFERRER_POLICY_VALUE)
                .body(listUseCase.execute(userId, sessionId));
    }

    @DeleteMapping("/users/me/oauth-accounts/{accountId}")
    public ResponseEntity<Void> unlink(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID accountId,
            @RequestBody OAuthUnlinkRequest request,
            HttpServletRequest httpRequest
    ) {
        webProtection.requireOriginAndCsrf(httpRequest);
        UUID userId = authenticatedUserId(jwt);
        UUID sessionId = authenticatedSessionId(jwt);
        rateLimiter.requireAllowed(AuthRateLimiter.Scope.OAUTH_UNLINK_SESSION, sessionId.toString());
        unlinkUseCase.execute(userId, sessionId, accountId, request == null ? null : request.currentPassword());
        return ResponseEntity.noContent()
                .cacheControl(CacheControl.noStore())
                .header(REFERRER_POLICY_HEADER, REFERRER_POLICY_VALUE)
                .build();
    }

    private static UUID authenticatedUserId(Jwt jwt) {
        try {
            if (jwt == null) {
                throw new IllegalArgumentException();
            }
            return UUID.fromString(jwt.getSubject());
        } catch (IllegalArgumentException | NullPointerException exception) {
            throw new UnauthorizedException("Authentication failed");
        }
    }

    private static UUID authenticatedSessionId(Jwt jwt) {
        try {
            if (jwt == null) {
                throw new IllegalArgumentException();
            }
            return UUID.fromString(jwt.getClaimAsString("sid"));
        } catch (IllegalArgumentException | NullPointerException exception) {
            throw new UnauthorizedException("Authentication failed");
        }
    }
}
