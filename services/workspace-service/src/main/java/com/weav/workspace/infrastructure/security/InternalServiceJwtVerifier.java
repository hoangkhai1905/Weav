package com.weav.workspace.infrastructure.security;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Verifies the short-lived RS256 service JWTs that Workflow sends to {@code /internal/workspaces/**}.
 * The JWKS file is read lazily so a missing file never stops startup; until it can be read every token is UNAVAILABLE.
 */
public final class InternalServiceJwtVerifier {

    public enum Result { OK, INVALID, UNAVAILABLE }

    /** What one internal endpoint requires from a token. */
    public record Required(String scope, UUID workspaceId, UUID connectionId) {
    }

    private static final Logger log = LoggerFactory.getLogger(InternalServiceJwtVerifier.class);
    static final String ISSUER = "weav-workflow";
    static final String AUDIENCE = "weav-workspace";
    private static final long SKEW_SECONDS = 10;
    private static final long MAX_LIFETIME_SECONDS = 60 + SKEW_SECONDS;
    private static final long MAX_JWKS_BYTES = 64 * 1024;

    private final Path jwksFile;
    private final Clock clock;
    private volatile JWKSet keys;

    public InternalServiceJwtVerifier(String jwksFile, Clock clock) {
        this.jwksFile = jwksFile == null || jwksFile.isBlank() ? null : Path.of(jwksFile);
        this.clock = clock;
    }

    public Result verify(String token, Required required) {
        JWKSet jwks = keys();
        if (jwks == null) {
            return Result.UNAVAILABLE;
        }
        try {
            SignedJWT jwt = SignedJWT.parse(token);
            if (!JWSAlgorithm.RS256.equals(jwt.getHeader().getAlgorithm()) || jwt.getHeader().getKeyID() == null
                    || !(jwks.getKeyByKeyId(jwt.getHeader().getKeyID()) instanceof RSAKey rsa)
                    || !jwt.verify(new RSASSAVerifier(rsa.toRSAPublicKey()))) {
                return invalid("signature");
            }
            return claimsMatch(jwt.getJWTClaimsSet(), required);
        } catch (Exception exception) {
            return invalid("unparseable");
        }
    }

    private Result claimsMatch(JWTClaimsSet claims, Required required) throws Exception {
        long now = clock.instant().getEpochSecond();
        Instant exp = claims.getExpirationTime() == null ? null : claims.getExpirationTime().toInstant();
        Instant iat = claims.getIssueTime() == null ? null : claims.getIssueTime().toInstant();
        if (exp == null || iat == null || exp.getEpochSecond() <= now - SKEW_SECONDS
                || iat.getEpochSecond() > now + SKEW_SECONDS
                || exp.getEpochSecond() - iat.getEpochSecond() > MAX_LIFETIME_SECONDS) {
            return invalid("lifetime");
        }
        if (!ISSUER.equals(claims.getIssuer()) || !List.of(AUDIENCE).equals(claims.getAudience())
                || claims.getJWTID() == null) {
            return invalid("issuer_audience");
        }
        if (!required.scope().equals(claims.getStringClaim("scope"))) {
            return invalid("scope");
        }
        if (!sameId(claims.getStringClaim("workspace_id"), required.workspaceId())
                || required.connectionId() != null
                && !sameId(claims.getStringClaim("connection_id"), required.connectionId())) {
            return invalid("resource");
        }
        return Result.OK;
    }

    private static boolean sameId(String claim, UUID expected) {
        try {
            return claim != null && expected.equals(UUID.fromString(claim));
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private Result invalid(String reason) {
        log.warn("event=internal_service_jwt_rejected reason={}", reason);
        return Result.INVALID;
    }

    private JWKSet keys() {
        JWKSet loaded = keys;
        if (loaded != null || jwksFile == null) {
            return loaded;
        }
        try {
            if (Files.size(jwksFile) > MAX_JWKS_BYTES) {
                return null;
            }
            loaded = JWKSet.parse(Files.readString(jwksFile, StandardCharsets.UTF_8));
            keys = loaded;
            return loaded;
        } catch (Exception exception) {
            log.warn("event=internal_service_jwks_unavailable");
            return null;
        }
    }
}
