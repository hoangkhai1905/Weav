package com.weav.identity.infrastructure.security;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTParser;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

import java.text.ParseException;

/**
 * Routes on the JWS {@code alg} header to exactly one decoder: HS256 to the shared-secret decoder,
 * RS256 to a decoder holding only RSA public keys. Anything else is rejected, so a token labelled
 * with one algorithm is never verified under the other's key (algorithm confusion).
 */
public final class AlgorithmRoutingJwtDecoder implements JwtDecoder {

    private final JwtDecoder hs256;
    private final JwtDecoder rs256;

    /** RS256 tokens are rejected when {@code rs256Keys} holds no public key. */
    public AlgorithmRoutingJwtDecoder(JwtDecoder hs256, JwtSigningKeys rs256Keys,
                                      OAuth2TokenValidator<Jwt> validator) {
        this.hs256 = hs256;
        this.rs256 = rs256Keys == null || rs256Keys.publicSet().getKeys().isEmpty()
                ? null : rsDecoder(rs256Keys, validator);
    }

    private static JwtDecoder rsDecoder(JwtSigningKeys keys, OAuth2TokenValidator<Jwt> validator) {
        var processor = new DefaultJWTProcessor<SecurityContext>();
        // kid lookup; this selector only ever yields RSA keys for RS256.
        processor.setJWSKeySelector(new JWSVerificationKeySelector<>(
                JWSAlgorithm.RS256, new ImmutableJWKSet<>(keys.publicSet())));
        // Claims are checked by the shared JwtAccessTokenValidator below.
        processor.setJWTClaimsSetVerifier((claims, context) -> { });
        NimbusJwtDecoder decoder = new NimbusJwtDecoder(processor);
        decoder.setJwtValidator(validator);
        return decoder;
    }

    @Override
    public Jwt decode(String token) throws JwtException {
        Object alg;
        try {
            alg = JWTParser.parse(token).getHeader().getAlgorithm();
        } catch (ParseException e) {
            throw new BadJwtException("Malformed token");
        }
        if (JWSAlgorithm.HS256.equals(alg)) {
            return hs256.decode(token);
        }
        if (JWSAlgorithm.RS256.equals(alg) && rs256 != null) {
            return rs256.decode(token);
        }
        throw new BadJwtException("Unsupported token algorithm");
    }
}
