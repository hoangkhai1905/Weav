package com.weav.workflow.infrastructure.security;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.PlainJWT;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.util.Date;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AlgorithmRoutingJwtDecoderTest {

    private static final String SECRET = "0123456789abcdef0123456789abcdef-test-secret";
    private static final String ISSUER = "weav-identity";
    private static final String AUDIENCE = "weav-api";

    private static HttpServer jwksServer;
    private static RSAKey signingKey;
    private static JwtDecoder decoder;
    private static JwtDecoder decoderWithUnreachableJwks;

    @BeforeAll
    static void startStubJwks() throws Exception {
        signingKey = new RSAKeyGenerator(2048).keyID("test-kid").generate();
        byte[] body = new JWKSet(signingKey.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);
        jwksServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        jwksServer.createContext("/jwks.json", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        jwksServer.start();
        String uri = "http://127.0.0.1:" + jwksServer.getAddress().getPort() + "/jwks.json";
        decoder = decoder(uri);
        // Port 1 refuses connections; building the decoder must not fetch anything.
        decoderWithUnreachableJwks = decoder("http://127.0.0.1:1/jwks.json");
    }

    @AfterAll
    static void stopStubJwks() {
        jwksServer.stop(0);
    }

    @Test
    void acceptsHs256TokenSignedWithSharedSecret() throws Exception {
        Jwt jwt = decoder.decode(hs256(SECRET.getBytes(StandardCharsets.UTF_8), "ACTIVE"));

        assertThat(jwt.getClaimAsString("user_status")).isEqualTo("ACTIVE");
    }

    @Test
    void acceptsRs256TokenFromJwksWithSameClaimChecks() throws Exception {
        Jwt jwt = decoder.decode(rs256(signingKey, "test-kid", "ACTIVE"));

        assertThat(jwt.getClaimAsString("system_role")).isEqualTo("USER");
        assertThatThrownBy(() -> decoder.decode(rs256(signingKey, "test-kid", "SUSPENDED")))
                .isInstanceOf(JwtException.class);
    }

    @Test
    void rejectsRs256TokenWithUnknownKid() throws Exception {
        assertThatThrownBy(() -> decoder.decode(rs256(signingKey, "other-kid", "ACTIVE")))
                .isInstanceOf(JwtException.class);
    }

    @Test
    void rejectsHs256TokenKeyedWithRsaPublicKeyBytes() throws Exception {
        byte[] publicKeyBytes = signingKey.toPublicJWK().toRSAPublicKey().getEncoded();
        // MACSigner insists on 256+ bit secrets; the encoded 2048-bit public key is longer than that.
        assertThatThrownBy(() -> decoder.decode(hs256(publicKeyBytes, "ACTIVE")))
                .isInstanceOf(JwtException.class);
    }

    @Test
    void rejectsAlgNone() {
        String token = new PlainJWT(claims("ACTIVE")).serialize();

        assertThatThrownBy(() -> decoder.decode(token)).isInstanceOf(JwtException.class);
    }

    @Test
    void rejectsRs256TokenWithJwtExceptionWhenJwksIsUnreachable() throws Exception {
        String token = rs256(signingKey, "test-kid", "ACTIVE");

        assertThatThrownBy(() -> decoderWithUnreachableJwks.decode(token)).isInstanceOf(JwtException.class);
        // HS256 keeps working while the JWKS is down.
        assertThat(decoderWithUnreachableJwks.decode(hs256(SECRET.getBytes(StandardCharsets.UTF_8), "ACTIVE")))
                .isNotNull();
    }

    private static JwtDecoder decoder(String jwksUri) {
        return new SecurityConfig().jwtDecoder(new JwtProperties(SECRET, ISSUER, AUDIENCE, Duration.ofSeconds(30)), Clock.systemUTC(), jwksUri);
    }

    private static JWTClaimsSet claims(String userStatus) {
        Date now = new Date();
        return new JWTClaimsSet.Builder()
                .issuer(ISSUER)
                .audience(AUDIENCE)
                .subject(UUID.randomUUID().toString())
                .jwtID(UUID.randomUUID().toString())
                .claim("sid", UUID.randomUUID().toString())
                .claim("token_use", "access")
                .claim("system_role", "USER")
                .claim("user_status", userStatus)
                .issueTime(now)
                .notBeforeTime(now)
                .expirationTime(new Date(now.getTime() + 600_000))
                .build();
    }

    private static String hs256(byte[] secret, String userStatus) throws Exception {
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.HS256).type(JOSEObjectType.JWT).build(),
                claims(userStatus));
        jwt.sign(new MACSigner(secret));
        return jwt.serialize();
    }

    private static String rs256(RSAKey key, String kid, String userStatus) throws Exception {
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(kid).type(JOSEObjectType.JWT).build(),
                claims(userStatus));
        jwt.sign(new RSASSASigner(key));
        return jwt.serialize();
    }
}
