package com.weav.identity.infrastructure.security;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.weav.identity.application.dto.IssuedAccessToken;
import com.weav.identity.application.port.out.AccessTokenIssuer;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.infrastructure.config.IdentityApplicationConfig;
import com.weav.identity.presentation.http.JwksController;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class Rs256AccessTokenTest {

    private static final String SECRET = "0123456789abcdef0123456789abcdef";
    private static final Clock CLOCK = Clock.fixed(Instant.now(), ZoneOffset.UTC);
    private static final UUID USER = UUID.randomUUID();
    private static final UUID SESSION = UUID.randomUUID();

    @TempDir
    Path dir;

    private final JwtProperties props = new JwtProperties(SECRET, "refresh-secret", "weav-identity",
            "weav-api", Duration.ofMinutes(15), Duration.ofDays(7), Duration.ofSeconds(30));
    private final IdentityApplicationConfig config = new IdentityApplicationConfig();
    private KeyPair currentPair;
    private Path keyFile;

    @BeforeEach
    void keys() throws Exception {
        currentPair = rsa(2048);
        keyFile = writePrivate("current.pem", currentPair);
    }

    @Test
    void rs256TokenCarriesKidAndVerifiesAgainstServedJwksAndIdentityDecoder() throws Exception {
        var signing = new JwtSigningProperties("RS256", keyFile.toString(), "k1", null, null);
        var keys = JwtSigningKeys.load(signing);

        String token = issue(signing, keys).value();
        SignedJWT jwt = SignedJWT.parse(token);
        assertEquals(JWSAlgorithm.RS256, jwt.getHeader().getAlgorithm());
        assertEquals("k1", jwt.getHeader().getKeyID());
        assertEquals(props.issuer(), jwt.getJWTClaimsSet().getIssuer());

        JWKSet served = JWKSet.parse(new JwksController(keys).jwks().getBody());
        assertTrue(jwt.verify(new com.nimbusds.jose.crypto.RSASSAVerifier(
                served.getKeyByKeyId("k1").toRSAKey().toRSAPublicKey())));

        Jwt decoded = config.jwtDecoder(props, keys, CLOCK).decode(token);
        assertEquals(USER.toString(), decoded.getSubject());
        assertEquals("ADMIN", decoded.getClaimAsString("system_role"));
    }

    @Test
    void hs256RemainsTheDefaultAndKeepsWorking() throws Exception {
        var signing = new JwtSigningProperties(null, null, null, null, null);
        var keys = JwtSigningKeys.load(signing); // HS256 without a key starts

        String token = issue(signing, keys).value();
        assertEquals(JWSAlgorithm.HS256, SignedJWT.parse(token).getHeader().getAlgorithm());
        assertEquals(USER.toString(), config.jwtDecoder(props, keys, CLOCK).decode(token).getSubject());
        assertEquals("{\"keys\":[]}", new JwksController(keys).jwks().getBody());
    }

    @Test
    void identityDecoderAcceptsBothAlgorithms() throws Exception {
        var signing = new JwtSigningProperties("RS256", keyFile.toString(), "k1", null, null);
        var keys = JwtSigningKeys.load(signing);
        JwtDecoder decoder = config.jwtDecoder(props, keys, CLOCK);

        String rs = issue(signing, keys).value();
        String hs = issue(new JwtSigningProperties("HS256", null, null, null, null), keys).value();
        assertEquals(USER.toString(), decoder.decode(rs).getSubject());
        assertEquals(USER.toString(), decoder.decode(hs).getSubject());
    }

    @Test
    void identityDecoderRejectsConfusionUnknownKidAndWrongAlgorithm() throws Exception {
        var signing = new JwtSigningProperties("RS256", keyFile.toString(), "k1", null, null);
        var keys = JwtSigningKeys.load(signing);
        JwtDecoder decoder = config.jwtDecoder(props, keys, CLOCK);

        // Classic confusion: HS256 token whose HMAC key is the RSA public key bytes.
        byte[] publicBytes = currentPair.getPublic().getEncoded();
        assertThrows(BadJwtException.class, () -> decoder.decode(
                hmac(publicBytes, JWSAlgorithm.HS256, "k1")));
        // HS256 signed with the real secret but claiming the RSA kid still takes the HS256 path and verifies
        // only under the shared secret; with a random secret it must fail.
        assertThrows(BadJwtException.class, () -> decoder.decode(
                hmac("another-secret-another-secret-123456".getBytes(), JWSAlgorithm.HS256, "k1")));
        // RS256 token signed by an unknown key (kid unknown, and also the right kid with a foreign key).
        KeyPair other = rsa(2048);
        assertThrows(BadJwtException.class, () -> decoder.decode(rsToken(other, "unknown-kid")));
        assertThrows(BadJwtException.class, () -> decoder.decode(rsToken(other, "k1")));
        // Wrong algorithms are never routed.
        assertThrows(BadJwtException.class, () -> decoder.decode(hmac(SECRET.getBytes(), JWSAlgorithm.HS512, null)));
        assertThrows(BadJwtException.class, () -> decoder.decode("not-a-jwt"));
    }

    @Test
    void hs256OnlyIdentityRejectsRs256Tokens() throws Exception {
        var keys = JwtSigningKeys.load(new JwtSigningProperties(null, null, null, null, null));
        assertThrows(BadJwtException.class,
                () -> config.jwtDecoder(props, keys, CLOCK).decode(rsToken(currentPair, "k1")));
    }

    @Test
    void jwksHasCurrentAndPreviousPublicKeysNoPrivateMembersAndCacheHeader() throws Exception {
        KeyPair previous = rsa(2048);
        Path previousPub = dir.resolve("previous.pub.pem");
        Files.writeString(previousPub, pem("PUBLIC KEY", previous.getPublic().getEncoded()));
        var signing = new JwtSigningProperties("RS256", keyFile.toString(), "k2", previousPub.toString(), "k1");
        var keys = JwtSigningKeys.load(signing);

        ResponseEntity<String> response = new JwksController(keys).jwks();
        assertEquals("max-age=300, public", response.getHeaders().getCacheControl());
        JWKSet served = JWKSet.parse(response.getBody());
        assertEquals(2, served.getKeys().size());
        assertTrue(served.getKeyByKeyId("k2") != null && served.getKeyByKeyId("k1") != null);
        for (String member : List.of("\"d\"", "\"p\"", "\"q\"", "\"dp\"", "\"dq\"", "\"qi\"")) {
            assertFalse(response.getBody().contains(member), member);
        }
        // Rotation: a token from the previous key still verifies once it is published.
        var oldSigning = JwtSigningKeys.load(new JwtSigningProperties("RS256",
                writePrivate("previous.pem", previous).toString(), "k1", null, null));
        String oldToken = issue(new JwtSigningProperties("RS256", "x", "k1", null, null), oldSigning).value();
        assertEquals(USER.toString(), config.jwtDecoder(props, keys, CLOCK).decode(oldToken).getSubject());
    }

    @Test
    void startupFailsClearlyWhenRs256KeyIsMissingOrWeak() throws Exception {
        var none = new JwtSigningProperties("RS256", null, null, null, null);
        assertTrue(assertThrows(IllegalStateException.class, () -> JwtSigningKeys.load(none))
                .getMessage().contains("JWT_SIGNING_KEY_LOCATION"));
        var missing = new JwtSigningProperties("RS256", dir.resolve("nope.pem").toString(), "k1", null, null);
        assertTrue(assertThrows(IllegalStateException.class, () -> JwtSigningKeys.load(missing))
                .getMessage().contains("not a readable"));
        Path weak = writePrivate("weak.pem", rsa(1024));
        var weakProps = new JwtSigningProperties("RS256", weak.toString(), "k1", null, null);
        assertTrue(assertThrows(IllegalStateException.class, () -> JwtSigningKeys.load(weakProps))
                .getMessage().contains("2048"));
        // HS256 with a configured but absent key file still starts.
        JwtSigningKeys.load(new JwtSigningProperties("HS256", dir.resolve("nope.pem").toString(), "k1", null, null));
    }

    private IssuedAccessToken issue(JwtSigningProperties signing, JwtSigningKeys keys) {
        JwtEncoder encoder = config.jwtEncoder(props, signing, keys);
        AccessTokenIssuer issuer = config.accessTokenIssuer(encoder, props, signing, CLOCK);
        return issuer.issue(USER, SESSION, SystemRole.ADMIN, UserStatus.ACTIVE);
    }

    private String hmac(byte[] key, JWSAlgorithm alg, String kid) throws Exception {
        byte[] padded = key.length >= 64 ? key : java.util.Arrays.copyOf(key, 64);
        var header = new JWSHeader.Builder(alg).type(JOSEObjectType.JWT).keyID(kid).build();
        SignedJWT jwt = new SignedJWT(header, claims());
        jwt.sign(new MACSigner(padded));
        return jwt.serialize();
    }

    private String rsToken(KeyPair pair, String kid) throws Exception {
        var header = new JWSHeader.Builder(JWSAlgorithm.RS256).type(JOSEObjectType.JWT).keyID(kid).build();
        SignedJWT jwt = new SignedJWT(header, claims());
        jwt.sign(new RSASSASigner((RSAPrivateKey) pair.getPrivate()));
        return jwt.serialize();
    }

    private JWTClaimsSet claims() {
        Instant now = CLOCK.instant();
        return new JWTClaimsSet.Builder().issuer(props.issuer()).audience(props.audience())
                .subject(USER.toString()).jwtID(UUID.randomUUID().toString())
                .issueTime(Date.from(now)).notBeforeTime(Date.from(now))
                .expirationTime(Date.from(now.plusSeconds(600)))
                .claim("sid", SESSION.toString()).claim("system_role", "ADMIN")
                .claim("user_status", "ACTIVE").claim("token_use", "access").build();
    }

    private static KeyPair rsa(int bits) throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(bits);
        return generator.generateKeyPair();
    }

    private Path writePrivate(String name, KeyPair pair) throws Exception {
        return Files.writeString(dir.resolve(name), pem("PRIVATE KEY", pair.getPrivate().getEncoded()));
    }

    private static String pem(String label, byte[] der) {
        return "-----BEGIN " + label + "-----\n"
                + Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(der)
                + "\n-----END " + label + "-----\n";
    }
}
