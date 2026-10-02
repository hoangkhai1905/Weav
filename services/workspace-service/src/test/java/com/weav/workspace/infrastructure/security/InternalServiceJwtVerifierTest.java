package com.weav.workspace.infrastructure.security;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Date;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** Throwaway RSA keys only; nothing here is a real credential. */
class InternalServiceJwtVerifierTest {

    private static final UUID WORKSPACE = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID CONNECTION = UUID.fromString("30000000-0000-0000-0000-000000000001");
    private static final UUID USER = UUID.fromString("20000000-0000-0000-0000-000000000001");
    private static final Instant NOW = Instant.parse("2026-10-02T10:00:00Z");
    private static final String STATIC_KEY = "workspace-key-0123456789-abcdefghijklmnop";

    @TempDir
    Path dir;
    private RSAKey signingKey;
    private InternalServiceKeyFilter filter;
    private InternalServiceKeyFilter requireJwtFilter;

    @BeforeEach
    void setUp() throws Exception {
        signingKey = new RSAKeyGenerator(2048).keyID("workflow-test-1").generate();
        Path jwks = dir.resolve("jwks.json");
        Files.writeString(jwks, new JWKSet(signingKey.toPublicJWK()).toString());
        var verifier = new InternalServiceJwtVerifier(jwks.toString(), Clock.fixed(NOW, ZoneOffset.UTC));
        filter = filter(new InternalServiceKeyProperties(STATIC_KEY, null, false), verifier);
        requireJwtFilter = filter(new InternalServiceKeyProperties(STATIC_KEY, null, true), verifier);
    }

    @Test
    void validTokenForEachScopeIsAccepted() throws Exception {
        String connections = "/internal/workspaces/" + WORKSPACE + "/connections/" + CONNECTION;
        assertEquals(200, call(filter, resolvePath(), token("connection:resolve", WORKSPACE, CONNECTION), null));
        assertEquals(200, call(filter, connections + "/auth-failure",
                token("connection:report-auth-failure", WORKSPACE, CONNECTION), null));
        assertEquals(200, call(filter, connections + "/authorize-attachment",
                token("connection:authorize-attachment", WORKSPACE, CONNECTION), null));
        assertEquals(200, call(filter, "/internal/workspaces/" + WORKSPACE + "/users/" + USER + "/access",
                token("workspace:access", WORKSPACE, null), null));
    }

    @Test
    void wrongScopeOrIdsAreRejected() throws Exception {
        assertEquals(401, call(filter, resolvePath(), token("connection:report-auth-failure", WORKSPACE, CONNECTION), null));
        assertEquals(401, call(filter, resolvePath(), token("connection:resolve", UUID.randomUUID(), CONNECTION), null));
        assertEquals(401, call(filter, resolvePath(), token("connection:resolve", WORKSPACE, UUID.randomUUID()), null));
        assertEquals(401, call(filter, resolvePath(), token("connection:resolve", WORKSPACE, null), null));
    }

    @Test
    void expiredWrongAudienceIssuerAndBadSignatureAreRejected() throws Exception {
        assertEquals(401, call(filter, resolvePath(), sign(signingKey,
                claims("connection:resolve", "weav-workspace", NOW.minusSeconds(300)).build()), null));
        assertEquals(401, call(filter, resolvePath(), sign(signingKey,
                claims("connection:resolve", "weav-ai", NOW).build()), null));
        assertEquals(401, call(filter, resolvePath(), sign(signingKey,
                claims("connection:resolve", "weav-workspace", NOW).issuer("other").build()), null));
        assertEquals(401, call(filter, resolvePath(), sign(new RSAKeyGenerator(2048).keyID("workflow-test-1").generate(),
                claims("connection:resolve", "weav-workspace", NOW).build()), null));
    }

    @Test
    void invalidTokenIsNotRescuedByTheStaticKey() throws Exception {
        assertEquals(401, call(filter, resolvePath(), token("wrong", WORKSPACE, CONNECTION), STATIC_KEY));
    }

    @Test
    void staticKeyWorksOnlyWhileServiceJwtIsNotRequired() throws Exception {
        assertEquals(200, call(filter, resolvePath(), null, STATIC_KEY));
        assertEquals(401, call(requireJwtFilter, resolvePath(), null, STATIC_KEY));
        assertEquals(200, call(requireJwtFilter, resolvePath(),
                token("connection:resolve", WORKSPACE, CONNECTION), STATIC_KEY));
    }

    @Test
    void missingJwksFileDoesNotCrashAndFallsBackToTheStaticKeyUnlessRequired() throws Exception {
        var verifier = new InternalServiceJwtVerifier(dir.resolve("absent.json").toString(), Clock.fixed(NOW, ZoneOffset.UTC));
        var open = filter(new InternalServiceKeyProperties(STATIC_KEY, null, false), verifier);
        var closed = filter(new InternalServiceKeyProperties(STATIC_KEY, null, true), verifier);
        String jwt = token("connection:resolve", WORKSPACE, CONNECTION);

        assertEquals(200, call(open, resolvePath(), jwt, STATIC_KEY));
        assertEquals(401, call(closed, resolvePath(), jwt, STATIC_KEY));
        assertEquals(401, call(closed, resolvePath(), jwt, null));
    }

    private String resolvePath() {
        return "/internal/workspaces/" + WORKSPACE + "/connections/" + CONNECTION + "/resolve";
    }

    private static InternalServiceKeyFilter filter(InternalServiceKeyProperties props, InternalServiceJwtVerifier verifier) {
        return new InternalServiceKeyFilter(props, (request, response, exception) -> response.setStatus(401), verifier);
    }

    private static int call(InternalServiceKeyFilter filter, String path, String bearer, String staticKey) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", path);
        request.setServletPath(path);
        if (bearer != null) {
            request.addHeader("Authorization", "Bearer " + bearer);
        }
        if (staticKey != null) {
            request.addHeader(InternalServiceKeyFilter.HEADER_NAME, staticKey);
        }
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = (req, res) -> ((MockHttpServletResponse) res).setStatus(200);
        filter.doFilter(request, response, chain);
        return response.getStatus();
    }

    private String token(String scope, UUID workspaceId, UUID connectionId) throws Exception {
        JWTClaimsSet.Builder builder = claims(scope, "weav-workspace", NOW).claim("workspace_id", workspaceId.toString());
        builder.claim("connection_id", connectionId == null ? null : connectionId.toString());
        return sign(signingKey, builder.build());
    }

    /** Valid ids for WORKSPACE/CONNECTION; the caller varies scope, audience or time. */
    private static JWTClaimsSet.Builder claims(String scope, String audience, Instant issuedAt) {
        return new JWTClaimsSet.Builder()
                .issuer("weav-workflow").audience(audience).jwtID(UUID.randomUUID().toString())
                .issueTime(Date.from(issuedAt)).expirationTime(Date.from(issuedAt.plusSeconds(60)))
                .claim("scope", scope)
                .claim("workspace_id", WORKSPACE.toString())
                .claim("connection_id", CONNECTION.toString());
    }

    private static String sign(RSAKey key, JWTClaimsSet claims) throws Exception {
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).type(JOSEObjectType.JWT)
                .keyID(key.getKeyID()).build(), claims);
        jwt.sign(new RSASSASigner(key));
        return jwt.serialize();
    }
}
