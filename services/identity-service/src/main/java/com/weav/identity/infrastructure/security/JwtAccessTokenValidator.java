package com.weav.identity.infrastructure.security;

import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public final class JwtAccessTokenValidator implements OAuth2TokenValidator<Jwt> {

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
        if (!hasExpectedIdentity(token)
                || !hasExpectedAuthorizationClaims(token)
                || !hasValidTimeClaims(token)) {
            return OAuth2TokenValidatorResult.failure(INVALID_TOKEN);
        }
        return OAuth2TokenValidatorResult.success();
    }

    private boolean hasExpectedIdentity(Jwt token) {
        if (!properties.issuer().equals(token.getClaimAsString("iss"))
                || !token.getAudience().contains(properties.audience())
                || !JwtAccessTokenIssuer.ACCESS_TOKEN_USE.equals(
                        token.getClaimAsString(JwtAccessTokenIssuer.TOKEN_USE_CLAIM))) {
            return false;
        }
        return isUuid(token.getSubject())
                && isUuid(token.getId())
                && isUuid(token.getClaimAsString(JwtAccessTokenIssuer.SESSION_ID_CLAIM));
    }

    private boolean hasExpectedAuthorizationClaims(Jwt token) {
        try {
            SystemRole.valueOf(token.getClaimAsString(JwtAccessTokenIssuer.SYSTEM_ROLE_CLAIM));
            UserStatus.valueOf(token.getClaimAsString(JwtAccessTokenIssuer.USER_STATUS_CLAIM));
            return true;
        } catch (IllegalArgumentException | NullPointerException exception) {
            return false;
        }
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
        if (issuedAt.isAfter(now.plus(properties.clockSkew()))) {
            return false;
        }
        if (notBefore.isAfter(now.plus(properties.clockSkew()))) {
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
