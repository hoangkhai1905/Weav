package com.weav.identity.infrastructure.security;

import com.weav.identity.application.dto.IssuedAccessToken;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwtValidationException;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class TokenServiceTest {

    private static final Instant NOW = Instant.parse("2026-09-05T12:00:00Z");
    private static final String ACCESS_SECRET = "0123456789abcdef0123456789abcdef";
    private static final UUID USER_ID = UUID.fromString("0e588d6f-b4b4-43a2-b1af-2c8127bdca3a");
    private static final UUID SESSION_ID = UUID.fromString("43630af5-e157-4844-98d7-5f9dfce6e987");

    private JwtProperties properties;
    private JwtEncoder encoder;
    private NimbusJwtDecoder decoder;

    @BeforeEach
    void setUp() {
        properties = new JwtProperties(
                ACCESS_SECRET,
                "refresh-secret",
                "weav-identity",
                "weav-clients",
                Duration.ofMinutes(15),
                Duration.ofDays(7),
                Duration.ofSeconds(30)
        );
        SecretKey secretKey = new SecretKeySpec(
                ACCESS_SECRET.getBytes(StandardCharsets.UTF_8),
                "HmacSHA256"
        );
        encoder = NimbusJwtEncoder.withSecretKey(secretKey)
                .algorithm(MacAlgorithm.HS256)
                .build();
        decoder = NimbusJwtDecoder.withSecretKey(secretKey)
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
        decoder.setJwtValidator(new JwtAccessTokenValidator(
                properties,
                Clock.fixed(NOW, ZoneOffset.UTC)
        ));
    }

    @Test
    void issuesAndValidatesAccessTokenWithRequiredIdentityAndAuthorizationClaims() {
        JwtAccessTokenIssuer issuer = new JwtAccessTokenIssuer(
                encoder,
                properties,
                Clock.fixed(NOW, ZoneOffset.UTC)
        );

        IssuedAccessToken issued = issuer.issue(
                USER_ID,
                SESSION_ID,
                SystemRole.ADMIN,
                UserStatus.ACTIVE
        );
        Jwt decoded = decoder.decode(issued.value());

        assertEquals(NOW.plus(Duration.ofMinutes(15)), issued.expiresAt());
        assertEquals(properties.issuer(), decoded.getClaimAsString("iss"));
        assertEquals(List.of(properties.audience()), decoded.getAudience());
        assertEquals(USER_ID.toString(), decoded.getSubject());
        assertEquals(SESSION_ID.toString(), decoded.getClaimAsString(JwtAccessTokenIssuer.SESSION_ID_CLAIM));
        assertEquals(SystemRole.ADMIN.name(), decoded.getClaimAsString(JwtAccessTokenIssuer.SYSTEM_ROLE_CLAIM));
        assertEquals(UserStatus.ACTIVE.name(), decoded.getClaimAsString(JwtAccessTokenIssuer.USER_STATUS_CLAIM));
        assertEquals(JwtAccessTokenIssuer.ACCESS_TOKEN_USE,
                decoded.getClaimAsString(JwtAccessTokenIssuer.TOKEN_USE_CLAIM));
        assertEquals(NOW, decoded.getIssuedAt());
        assertEquals(NOW, decoded.getNotBefore());
        assertEquals(issued.expiresAt(), decoded.getExpiresAt());
    }

    @Test
    void rejectsSignedTokenWithWrongTokenUse() {
        String token = encodeToken("refresh", NOW.minusSeconds(1), NOW.plusSeconds(60));

        assertThrows(JwtValidationException.class, () -> decoder.decode(token));
    }

    @Test
    void rejectsExpiredSignedToken() {
        String token = encodeToken(
                JwtAccessTokenIssuer.ACCESS_TOKEN_USE,
                NOW.minus(Duration.ofMinutes(2)),
                NOW.minus(Duration.ofSeconds(31))
        );

        assertThrows(JwtValidationException.class, () -> decoder.decode(token));
    }

    private String encodeToken(String tokenUse, Instant issuedAt, Instant expiresAt) {
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(properties.issuer())
                .subject(USER_ID.toString())
                .audience(List.of(properties.audience()))
                .issuedAt(issuedAt)
                .notBefore(issuedAt)
                .expiresAt(expiresAt)
                .id(UUID.fromString("23161037-ab45-468f-bbb4-00884f3f23cb").toString())
                .claim(JwtAccessTokenIssuer.SESSION_ID_CLAIM, SESSION_ID.toString())
                .claim(JwtAccessTokenIssuer.SYSTEM_ROLE_CLAIM, SystemRole.USER.name())
                .claim(JwtAccessTokenIssuer.USER_STATUS_CLAIM, UserStatus.ACTIVE.name())
                .claim(JwtAccessTokenIssuer.TOKEN_USE_CLAIM, tokenUse)
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256)
                .type("JWT")
                .build();
        return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
    }
}
