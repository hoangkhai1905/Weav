package com.weav.workspace.infrastructure.security;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jwt.JWTParser;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;

import java.text.ParseException;

/**
 * Routes a token to exactly one delegate by its {@code alg} header: HS256 to the shared-secret decoder,
 * RS256 to the JWKS decoder. There is no fallback between delegates, so a token can never be verified
 * under the other algorithm's key (algorithm confusion). Any other algorithm, including {@code none}, is rejected.
 */
public final class AlgorithmRoutingJwtDecoder implements JwtDecoder {

    private final JwtDecoder hs256;
    private final JwtDecoder rs256;

    public AlgorithmRoutingJwtDecoder(JwtDecoder hs256, JwtDecoder rs256) {
        this.hs256 = hs256;
        this.rs256 = rs256;
    }

    @Override
    public Jwt decode(String token) throws JwtException {
        JWSAlgorithm algorithm;
        try {
            algorithm = JWSAlgorithm.parse(JWTParser.parse(token).getHeader().getAlgorithm().getName());
        } catch (ParseException | RuntimeException exception) {
            throw new BadJwtException("The access token is malformed");
        }
        if (JWSAlgorithm.HS256.equals(algorithm)) {
            return hs256.decode(token);
        }
        if (JWSAlgorithm.RS256.equals(algorithm)) {
            return rs256.decode(token);
        }
        throw new BadJwtException("Unsupported token algorithm");
    }
}
