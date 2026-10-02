package com.weav.identity.presentation.http.oauth;

import com.weav.identity.application.dto.OAuthConfiguration;
import com.weav.identity.application.validation.OAuthProtocolPolicy;
import com.weav.identity.domain.exception.ForbiddenException;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.infrastructure.security.JwtProperties;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Objects;

/** Exact-origin, signed-CSRF and cookie policy for the web OAuth transport. */
@Component
public final class OAuthWebProtection {

    public static final String CORRELATION_COOKIE = "__Secure-weav_oauth_tx";
    public static final String REFRESH_COOKIE = "__Secure-weav_refresh";
    public static final String CSRF_COOKIE = "XSRF-TOKEN";
    public static final String CSRF_HEADER = "X-XSRF-TOKEN";

    private final OAuthConfiguration configuration;
    private final JwtProperties jwtProperties;
    private final OAuthCsrfTokenService csrfTokenService;

    public OAuthWebProtection(
            OAuthConfiguration configuration,
            JwtProperties jwtProperties,
            OAuthCsrfTokenService csrfTokenService
    ) {
        this.configuration = Objects.requireNonNull(configuration, "configuration must not be null");
        this.jwtProperties = Objects.requireNonNull(jwtProperties, "jwtProperties must not be null");
        this.csrfTokenService = Objects.requireNonNull(csrfTokenService, "csrfTokenService must not be null");
    }

    public void requireAllowedOrigin(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        boolean allowed = configuration.webClient()
                .map(registration -> registration.allowsOrigin(origin))
                .orElse(false);
        if (!allowed) {
            throw new ForbiddenException();
        }
    }

    public void requireOriginAndCsrf(HttpServletRequest request) {
        requireAllowedOrigin(request);
        String cookie = singleCookie(request, CSRF_COOKIE);
        String header = request.getHeader(CSRF_HEADER);
        if (cookie == null || header == null || !cookie.equals(header)
                || !csrfTokenService.isValid(cookie)) {
            throw new ForbiddenException();
        }
    }

    public String issueCsrfToken() {
        return csrfTokenService.issue();
    }

    public ResponseCookie csrfCookie(String token) {
        return cookie(CSRF_COOKIE, token, false, configuration.csrfTtl(),
                configuration.cookies().csrfCookiePath());
    }

    public ResponseCookie correlationCookie(String transactionId) {
        return cookie(
                CORRELATION_COOKIE,
                transactionId,
                true,
                configuration.stateTtl(),
                configuration.cookies().correlationCookiePath());
    }

    public ResponseCookie clearCorrelationCookie() {
        return cookie(
                CORRELATION_COOKIE,
                "",
                true,
                Duration.ZERO,
                configuration.cookies().correlationCookiePath());
    }

    public ResponseCookie refreshCookie(String refreshToken) {
        return cookie(
                REFRESH_COOKIE,
                refreshToken,
                true,
                jwtProperties.refreshExpiresIn(),
                configuration.cookies().refreshCookiePath());
    }

    public ResponseCookie clearRefreshCookie() {
        return cookie(
                REFRESH_COOKIE,
                "",
                true,
                Duration.ZERO,
                configuration.cookies().refreshCookiePath());
    }

    /**
     * Reads the cookie-only web refresh credential after origin and CSRF
     * admission. Duplicate, missing, or malformed cookies are deliberately
     * indistinguishable from an invalid authentication attempt.
     */
    public String requireRefreshToken(HttpServletRequest request) {
        String value = singleCookie(request, REFRESH_COOKIE);
        try {
            return OAuthProtocolPolicy.requireOpaqueToken(value, "refresh cookie");
        } catch (IllegalArgumentException exception) {
            throw new UnauthorizedException("Authentication failed");
        }
    }

    private ResponseCookie cookie(
            String name,
            String value,
            boolean httpOnly,
            Duration maxAge,
            String path
    ) {
        return ResponseCookie.from(name, value)
                .httpOnly(httpOnly)
                .secure(configuration.cookies().secure())
                .sameSite(configuration.cookies().sameSite())
                .path(path)
                .maxAge(maxAge)
                .build();
    }

    private static String singleCookie(HttpServletRequest request, String name) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return null;
        }
        String value = null;
        for (Cookie cookie : cookies) {
            if (!name.equals(cookie.getName())) {
                continue;
            }
            if (value != null) {
                return null;
            }
            value = cookie.getValue();
        }
        return value;
    }
}
