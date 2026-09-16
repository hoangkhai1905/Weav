package com.weav.workspace.infrastructure.security;

import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Clock;
import java.time.Instant;
import java.util.Set;
import java.util.Objects;
import java.util.UUID;

/**
 * Workspace-local validation of Identity's access-token claims.
 *
 * <p>Workspace intentionally does not depend on Identity Java classes. The
 * accepted algorithm, issuer, audience, token-use, and identity claims mirror
 * Identity's access-token validator.</p>
 */
public final class JwtAccessTokenValidator implements OAuth2TokenValidator<Jwt> {

    public static final String TOKEN_USE_CLAIM = "token_use";
    public static final String ACCESS_TOKEN_USE = "access";
    public static final String SESSION_ID_CLAIM = "sid";
    public static final String SYSTEM_ROLE_CLAIM = "system_role";
    public static final String USER_STATUS_CLAIM = "user_status";
    private static final Set<String> SYSTEM_ROLES = Set.of("USER", "ADMIN");
    private static final Set<String> USER_STATUSES = Set.of("ACTIVE", "DISABLED");

    private static final OAuth2Error INVALID_TOKEN =
            new OAuth2Error("invalid_token", "The access token is invalid", null);

    private final JwtProperties properties;
    private final Clock clock;

    public JwtAccessTokenValidator(JwtProperties properties, Clock clock) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt token) {
        try {
            if (!hasExpectedIdentity(token)
                    || !hasExpectedAuthorizationClaims(token)
                    || !hasValidTimeClaims(token)) {
                return OAuth2TokenValidatorResult.failure(INVALID_TOKEN);
            }
            return OAuth2TokenValidatorResult.success();
        } catch (RuntimeException exception) {
            return OAuth2TokenValidatorResult.failure(INVALID_TOKEN);
        }
    }

    private boolean hasExpectedIdentity(Jwt token) {
        return properties.issuer().equals(token.getClaimAsString("iss"))
                && token.getAudience().contains(properties.audience())
                && ACCESS_TOKEN_USE.equals(token.getClaimAsString(TOKEN_USE_CLAIM))
                && isUuid(token.getSubject())
                && isUuid(token.getId())
                && isUuid(token.getClaimAsString(SESSION_ID_CLAIM));
    }

    private boolean hasExpectedAuthorizationClaims(Jwt token) {
        return SYSTEM_ROLES.contains(token.getClaimAsString(SYSTEM_ROLE_CLAIM))
                && USER_STATUSES.contains(token.getClaimAsString(USER_STATUS_CLAIM));
    }

    private boolean hasValidTimeClaims(Jwt token) {
        Instant issuedAt = token.getIssuedAt();
        Instant notBefore = token.getNotBefore();
        Instant expiresAt = token.getExpiresAt();
        if (issuedAt == null || notBefore == null || expiresAt == null) {
            return false;
        }
        if (!expiresAt.isAfter(issuedAt) || !expiresAt.isAfter(notBefore)) {
            return false;
        }

        Instant now = clock.instant();
        if (issuedAt.isAfter(now.plus(properties.clockSkew()))
                || notBefore.isAfter(now.plus(properties.clockSkew()))) {
            return false;
        }
        return expiresAt.plus(properties.clockSkew()).isAfter(now);
    }

    private static boolean isUuid(String value) {
        if (value == null) {
            return false;
        }
        try {
            UUID.fromString(value);
            return true;
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }
}
