package com.weav.identity.presentation.http;

import com.weav.identity.application.dto.OAuthCallbackCommand;
import com.weav.identity.application.dto.OAuthCallbackResult;
import com.weav.identity.application.dto.OAuthClientRegistration;
import com.weav.identity.application.dto.OAuthExchangeResult;
import com.weav.identity.application.dto.OAuthStartCommand;
import com.weav.identity.application.dto.OAuthStartResult;
import com.weav.identity.application.dto.RefreshTokenCommand;
import com.weav.identity.application.dto.TokenPairResult;
import com.weav.identity.application.usecase.LoginUseCase;
import com.weav.identity.application.usecase.LogoutUseCase;
import com.weav.identity.application.usecase.OAuthFlowCoordinator;
import com.weav.identity.application.usecase.RefreshSessionUseCase;
import com.weav.identity.domain.exception.InvalidOAuthClientException;
import com.weav.identity.domain.exception.OAuthCallbackInvalidException;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.infrastructure.config.OAuthEnabledCondition;
import com.weav.identity.presentation.http.oauth.OAuthWebProtection;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.infrastructure.security.AuthRateLimiter;
import com.weav.identity.presentation.http.request.LoginRequest;
import com.weav.identity.presentation.http.request.OAuthExchangeRequest;
import com.weav.identity.presentation.http.request.OAuthMobileExchangeRequest;
import com.weav.identity.presentation.http.request.OAuthStartRequest;
import com.weav.identity.presentation.http.response.OAuthCsrfResponse;
import com.weav.identity.presentation.http.response.OAuthLinkExchangeResponse;
import com.weav.identity.presentation.http.response.OAuthLoginExchangeResponse;
import com.weav.identity.presentation.http.response.OAuthStartResponse;
import com.weav.identity.presentation.http.response.TokenResponse;
import com.weav.identity.presentation.http.mapper.UserPresentationMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.context.annotation.Conditional;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.UUID;

/** HTTP-only adapter for the approved Google OAuth web transport routes. */
@RestController
@RequestMapping("/auth")
@Conditional(OAuthEnabledCondition.class)
@ConditionalOnBean(OAuthFlowCoordinator.class)
public final class OAuthController {

    private static final String REFERRER_POLICY_HEADER = "Referrer-Policy";
    private static final String REFERRER_POLICY_VALUE = "no-referrer";
    private static final int MAX_USER_AGENT_LENGTH = 512;
    private static final int MAX_IP_ADDRESS_LENGTH = 45;

    private final OAuthFlowCoordinator coordinator;
    private final OAuthWebProtection webProtection;
    private final UserPresentationMapper userPresentationMapper;
    private final RefreshSessionUseCase refreshSessionUseCase;
    private final LogoutUseCase logoutUseCase;
    private final LoginUseCase loginUseCase;
    private final AuthRateLimiter rateLimiter;
    private final AuthInputPolicy inputPolicy;

    public OAuthController(
            OAuthFlowCoordinator coordinator,
            OAuthWebProtection webProtection,
            UserPresentationMapper userPresentationMapper,
            RefreshSessionUseCase refreshSessionUseCase,
            LogoutUseCase logoutUseCase,
            LoginUseCase loginUseCase,
            AuthRateLimiter rateLimiter,
            AuthInputPolicy inputPolicy
    ) {
        this.coordinator = coordinator;
        this.webProtection = webProtection;
        this.userPresentationMapper = userPresentationMapper;
        this.refreshSessionUseCase = refreshSessionUseCase;
        this.logoutUseCase = logoutUseCase;
        this.loginUseCase = loginUseCase;
        this.rateLimiter = rateLimiter;
        this.inputPolicy = inputPolicy;
    }

    @PostMapping("/oauth/google/start")
    public ResponseEntity<OAuthStartResponse> startLogin(
            @Valid @RequestBody OAuthStartRequest request,
            HttpServletRequest httpRequest
    ) {
        webProtection.requireAllowedOrigin(httpRequest);
        requireWebClient(request.clientId());
        String csrfToken = webProtection.issueCsrfToken();
        OAuthStartResult result = coordinator.startLogin(request.toCommand());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(REFERRER_POLICY_HEADER, REFERRER_POLICY_VALUE)
                .header(HttpHeaders.SET_COOKIE, webProtection.correlationCookie(result.transactionId()).toString())
                .header(HttpHeaders.SET_COOKIE, webProtection.csrfCookie(csrfToken).toString())
                .body(new OAuthStartResponse(result.transactionId(), result.authorizationUrl(), csrfToken));
    }

    /**
     * Mobile sign-in start. The app opens this URL in the system browser (an in-app auth session) so the
     * correlation cookie lands in the browser that later receives Google's callback. There is no page, so
     * no Origin or CSRF check applies; the PKCE challenge is the only caller-supplied value.
     */
    @GetMapping("/oauth/google/mobile/start")
    public ResponseEntity<Void> startMobileLogin(
            @RequestParam @NotBlank @Pattern(regexp = "^[A-Za-z0-9_-]{43}$") String codeChallenge,
            @RequestParam @NotBlank @Pattern(regexp = "^S256$") String codeChallengeMethod
    ) {
        OAuthStartResult result = coordinator.startLogin(new OAuthStartCommand(
                OAuthClientRegistration.MOBILE,
                OAuthClientRegistration.MOBILE,
                codeChallenge,
                codeChallengeMethod));
        return ResponseEntity.status(HttpStatus.SEE_OTHER)
                .location(result.authorizationUrl())
                .cacheControl(CacheControl.noStore())
                .header(REFERRER_POLICY_HEADER, REFERRER_POLICY_VALUE)
                .header(HttpHeaders.SET_COOKIE, webProtection.correlationCookie(result.transactionId()).toString())
                .build();
    }

    @GetMapping("/oauth/google/callback")
    public ResponseEntity<Void> callback(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String error,
            @CookieValue(value = OAuthWebProtection.CORRELATION_COOKIE, required = false) String correlationTransactionId
    ) {
        if (correlationTransactionId == null || state == null || state.isBlank()) {
            throw new OAuthCallbackInvalidException();
        }
        if (error != null && !error.isBlank() && code != null && !code.isBlank()) {
            throw new OAuthCallbackInvalidException();
        }

        final OAuthCallbackCommand command;
        try {
            if (error != null && !error.isBlank()) {
                command = OAuthCallbackCommand.cancelled(
                        correlationTransactionId,
                        new com.weav.identity.application.dto.OAuthSecret(state));
            } else if (code != null && !code.isBlank()) {
                command = OAuthCallbackCommand.withAuthorizationCode(
                        correlationTransactionId,
                        new com.weav.identity.application.dto.OAuthSecret(state),
                        new com.weav.identity.application.dto.OAuthSecret(code));
            } else {
                throw new IllegalArgumentException("callback result is incomplete");
            }
        } catch (IllegalArgumentException exception) {
            throw new OAuthCallbackInvalidException();
        }

        OAuthCallbackResult result = coordinator.callback(command);
        if (result.status() == OAuthCallbackResult.Status.INVALID) {
            throw new OAuthCallbackInvalidException();
        }

        URI redirect = redirectFor(result);
        return ResponseEntity.status(HttpStatus.SEE_OTHER)
                .location(redirect)
                .cacheControl(CacheControl.noStore())
                .header(REFERRER_POLICY_HEADER, REFERRER_POLICY_VALUE)
                .header(HttpHeaders.SET_COOKIE, webProtection.clearCorrelationCookie().toString())
                .build();
    }

    @PostMapping("/oauth/exchange")
    public ResponseEntity<?> exchange(
            @Valid @RequestBody OAuthExchangeRequest request,
            @AuthenticationPrincipal Jwt jwt,
            HttpServletRequest httpRequest
    ) {
        webProtection.requireOriginAndCsrf(httpRequest);
        requireWebClient(request.clientId());
        if (jwt == null && hasAuthorizationHeader(httpRequest)) {
            throw new UnauthorizedException("Authentication failed");
        }

        OAuthExchangeResult result;
        if (jwt == null) {
            result = coordinator.exchangeLogin(
                    request.toCommand(),
                    truncate(httpRequest.getHeader("User-Agent"), MAX_USER_AGENT_LENGTH),
                    truncate(httpRequest.getRemoteAddr(), MAX_IP_ADDRESS_LENGTH));
        } else {
            result = coordinator.exchangeLink(
                    authenticatedUserId(jwt),
                    authenticatedSessionId(jwt),
                    request.toCommand());
        }

        if (result.outcome() == OAuthExchangeResult.Outcome.LOGIN) {
            var login = result.login();
            return ResponseEntity.ok()
                    .cacheControl(CacheControl.noStore())
                    .header(REFERRER_POLICY_HEADER, REFERRER_POLICY_VALUE)
                    .header(HttpHeaders.SET_COOKIE, webProtection.refreshCookie(login.refreshToken()).toString())
                    .body(new OAuthLoginExchangeResponse(
                            "LOGIN",
                            login.accessToken(),
                            login.tokenType(),
                            login.expiresIn(),
                            userPresentationMapper.toResponse(login.user())));
        }

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(REFERRER_POLICY_HEADER, REFERRER_POLICY_VALUE)
                .body(new OAuthLinkExchangeResponse("LINKED", result.linked()));
    }

    /**
     * Mobile LOGIN exchange (LINK stays web-only). Same one-use handoff, PKCE S256 and failure cap as the web
     * exchange, bound to client {@code mobile}. The session comes back in the body exactly like
     * {@code POST /auth/login}: there is no browser, so no cookies and no CSRF.
     */
    @PostMapping("/oauth/mobile/exchange")
    public ResponseEntity<TokenResponse> mobileExchange(
            @Valid @RequestBody OAuthMobileExchangeRequest request,
            HttpServletRequest httpRequest
    ) {
        OAuthExchangeResult result = coordinator.exchangeLogin(
                request.toCommand(),
                truncate(httpRequest.getHeader("User-Agent"), MAX_USER_AGENT_LENGTH),
                truncate(httpRequest.getRemoteAddr(), MAX_IP_ADDRESS_LENGTH));
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(REFERRER_POLICY_HEADER, REFERRER_POLICY_VALUE)
                .body(userPresentationMapper.toResponse(result.login()));
    }

    @GetMapping("/web/csrf")
    public ResponseEntity<OAuthCsrfResponse> csrf(HttpServletRequest httpRequest) {
        webProtection.requireAllowedOrigin(httpRequest);
        String csrfToken = webProtection.issueCsrfToken();
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(REFERRER_POLICY_HEADER, REFERRER_POLICY_VALUE)
                .header(HttpHeaders.SET_COOKIE, webProtection.csrfCookie(csrfToken).toString())
                .body(new OAuthCsrfResponse(csrfToken));
    }

    /**
     * Password login for the web client: same checks and rate limits as {@code /auth/login}, but the refresh
     * token goes into the HttpOnly cookie so the session survives reloads like a Google one.
     */
    @PostMapping("/web/login")
    public ResponseEntity<OAuthLoginExchangeResponse> loginWeb(
            @Valid @RequestBody LoginRequest request,
            HttpServletRequest httpRequest
    ) {
        webProtection.requireOriginAndCsrf(httpRequest);
        String account = inputPolicy.canonicalizeEmail(request.email());
        rateLimiter.requireAllowed(AuthRateLimiter.Scope.LOGIN_ACCOUNT, account);
        TokenPairResult result = loginUseCase.execute(userPresentationMapper.toCommand(
                request,
                truncate(httpRequest.getHeader("User-Agent"), MAX_USER_AGENT_LENGTH),
                truncate(httpRequest.getRemoteAddr(), MAX_IP_ADDRESS_LENGTH)));
        rateLimiter.refund(AuthRateLimiter.Scope.LOGIN_ACCOUNT, account);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(REFERRER_POLICY_HEADER, REFERRER_POLICY_VALUE)
                .header(HttpHeaders.SET_COOKIE, webProtection.refreshCookie(result.refreshToken()).toString())
                .body(new OAuthLoginExchangeResponse(
                        "LOGIN",
                        result.accessToken(),
                        result.tokenType(),
                        result.expiresIn(),
                        userPresentationMapper.toResponse(result.user())));
    }

    @PostMapping("/web/refresh")
    public ResponseEntity<OAuthLoginExchangeResponse> refreshWeb(HttpServletRequest httpRequest) {
        webProtection.requireOriginAndCsrf(httpRequest);
        TokenPairResult result = refreshSessionUseCase.execute(
                new RefreshTokenCommand(webProtection.requireRefreshToken(httpRequest)));
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(REFERRER_POLICY_HEADER, REFERRER_POLICY_VALUE)
                .header(HttpHeaders.SET_COOKIE, webProtection.refreshCookie(result.refreshToken()).toString())
                .body(new OAuthLoginExchangeResponse(
                        "LOGIN",
                        result.accessToken(),
                        result.tokenType(),
                        result.expiresIn(),
                        userPresentationMapper.toResponse(result.user())));
    }

    @PostMapping("/web/logout")
    public ResponseEntity<Void> logoutWeb(HttpServletRequest httpRequest) {
        webProtection.requireOriginAndCsrf(httpRequest);
        logoutUseCase.execute(new RefreshTokenCommand(webProtection.requireRefreshToken(httpRequest)));
        return ResponseEntity.noContent()
                .cacheControl(CacheControl.noStore())
                .header(REFERRER_POLICY_HEADER, REFERRER_POLICY_VALUE)
                .header(HttpHeaders.SET_COOKIE, webProtection.clearRefreshCookie().toString())
                .build();
    }

    private URI redirectFor(OAuthCallbackResult result) {
        UriComponentsBuilder builder = UriComponentsBuilder.fromUri(result.returnTargetUri())
                .queryParam("transaction_id", result.transactionId());
        switch (result.status()) {
            case COMPLETED -> builder.queryParam("handoff_code", result.handoffCode().value());
            case CANCELLED -> builder.queryParam("oauth_error", "cancelled");
            case PROVIDER_UNAVAILABLE -> builder.queryParam("oauth_error", "provider_unavailable");
            case INVALID -> throw new OAuthCallbackInvalidException();
        }
        return builder.build().encode().toUri();
    }

    /** The Origin/CSRF web transport serves only the web registration; mobile has its own routes. */
    private static void requireWebClient(String clientId) {
        if (!OAuthClientRegistration.WEB.equals(clientId)) {
            throw new InvalidOAuthClientException();
        }
    }

    private static boolean hasAuthorizationHeader(HttpServletRequest request) {
        return request.getHeader(HttpHeaders.AUTHORIZATION) != null;
    }

    private static UUID authenticatedUserId(Jwt jwt) {
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (IllegalArgumentException | NullPointerException exception) {
            throw new UnauthorizedException("Authentication failed");
        }
    }

    private static UUID authenticatedSessionId(Jwt jwt) {
        try {
            return UUID.fromString(jwt.getClaimAsString("sid"));
        } catch (IllegalArgumentException | NullPointerException exception) {
            throw new UnauthorizedException("Authentication failed");
        }
    }

    private static String truncate(String value, int maxLength) {
        if (value == null) {
            return null;
        }
        return value.length() <= maxLength ? value : value.substring(0, maxLength);
    }
}
