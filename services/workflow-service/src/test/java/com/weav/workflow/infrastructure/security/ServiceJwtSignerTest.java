package com.weav.workflow.infrastructure.security;

import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.DefaultResourceLoader;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ServiceJwtSignerTest {
    @TempDir
    Path tempDir;

    @Test
    void signsRs256WithAudienceClaimsAndBoundedLifetime() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair pair = generator.generateKeyPair();
        Path pem = tempDir.resolve("key.pem");
        Files.writeString(pem, "-----BEGIN PRIVATE KEY-----\n"
                + Base64.getMimeEncoder().encodeToString(pair.getPrivate().getEncoded()) + "\n-----END PRIVATE KEY-----\n");
        ServiceJwtSigner signer = new ServiceJwtSigner(new DefaultResourceLoader(), "kid-1", pem.toUri().toString(), Duration.ofSeconds(60));

        SignedJWT jwt = SignedJWT.parse(signer.sign("weav-workflow", "weav-ai",
                Map.of("scope", "ai:summarize", "request_id", "r"), Instant.parse("2026-09-30T00:00:00Z")));

        assertTrue(jwt.verify(new RSASSAVerifier((RSAPublicKey) pair.getPublic())));
        assertEquals("kid-1", jwt.getHeader().getKeyID());
        assertEquals("weav-ai", jwt.getJWTClaimsSet().getAudience().get(0));
        assertEquals("ai:summarize", jwt.getJWTClaimsSet().getStringClaim("scope"));
        assertEquals(60, (jwt.getJWTClaimsSet().getExpirationTime().getTime() - jwt.getJWTClaimsSet().getIssueTime().getTime()) / 1000);
    }

    @Test
    void missingKeyIsUnavailable() {
        ServiceJwtSigner signer = new ServiceJwtSigner(new DefaultResourceLoader(), "kid", "", Duration.ofSeconds(60));
        assertThrows(ServiceJwtSigner.Unavailable.class, () -> signer.sign("i", "a", Map.of(), Instant.now()));
    }
}
