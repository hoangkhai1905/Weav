package com.weav.identity.infrastructure.security;

import com.weav.identity.application.dto.IssuedAccessToken;
import com.weav.identity.application.port.out.AccessTokenIssuer;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwsHeader;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

public final class JwtAccessTokenIssuer implements AccessTokenIssuer {

    public static final String SESSION_ID_CLAIM = "sid";
    public static final String SYSTEM_ROLE_CLAIM = "system_role";
    public static final String USER_STATUS_CLAIM = "user_status";
    public static final String TOKEN_USE_CLAIM = "token_use";
    public static final String ACCESS_TOKEN_USE = "access";

    private final JwtEncoder jwtEncoder;
    private final JwtProperties properties;
    private final Clock clock;

    public JwtAccessTokenIssuer(JwtEncoder jwtEncoder, JwtProperties properties, Clock clock) {
        this.jwtEncoder = Objects.requireNonNull(jwtEncoder, "jwtEncoder must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    @Override
    public IssuedAccessToken issue(UUID userId, UUID sessionId, SystemRole systemRole, UserStatus userStatus) {
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        Objects.requireNonNull(systemRole, "systemRole must not be null");
        Objects.requireNonNull(userStatus, "userStatus must not be null");

        Instant issuedAt = clock.instant();
        Instant expiresAt = issuedAt.plus(properties.accessExpiresIn());
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(properties.issuer())
                .subject(userId.toString())
                .audience(List.of(properties.audience()))
                .issuedAt(issuedAt)
                .notBefore(issuedAt)
                .expiresAt(expiresAt)
                .id(UUID.randomUUID().toString())
                .claim(SESSION_ID_CLAIM, sessionId.toString())
                .claim(SYSTEM_ROLE_CLAIM, systemRole.name())
                .claim(USER_STATUS_CLAIM, userStatus.name())
                .claim(TOKEN_USE_CLAIM, ACCESS_TOKEN_USE)
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256)
                .type("JWT")
                .build();
        String value = jwtEncoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
        return new IssuedAccessToken(value, expiresAt);
    }
}
