package com.weav.workflow.infrastructure.ocr;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.weav.workflow.application.node.NodeExecutor;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.DefaultResourceLoader;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OcrServiceJwtTest {

    @TempDir
    Path tempDir;

    @Test
    void signsRs256WithTheWorkflowExecutionClaimsAndSixtySecondLifetime() throws Exception {
        KeyPair keyPair = keyPair();
        Path privateKey = writePrivateKey(keyPair);
        OcrClientProperties properties = properties(privateKey.toUri().toString(), Duration.ofSeconds(60));
        WorkflowServiceJwtIssuer issuer = new WorkflowServiceJwtIssuer(properties, new DefaultResourceLoader());
        Instant now = Instant.parse("2026-09-23T01:02:03Z");
        NodeExecutor.Context context = context();

        SignedJWT token = SignedJWT.parse(issuer.issue(context, now));

        assertTrue(token.verify(new RSASSAVerifier((java.security.interfaces.RSAPublicKey) keyPair.getPublic())));
        JWTClaimsSet claims = token.getJWTClaimsSet();
        assertEquals("RS256", token.getHeader().getAlgorithm().getName());
        assertEquals("workflow-test-key", token.getHeader().getKeyID());
        assertEquals("weav-workflow", claims.getIssuer());
        assertEquals(java.util.List.of("weav-ocr"), claims.getAudience());
        assertEquals("ocr:extract", claims.getStringClaim("scope"));
        assertEquals(context.workspaceId().toString(), claims.getStringClaim("workspace_id"));
        assertEquals("execution", claims.getStringClaim("mode"));
        assertEquals(context.executionId().toString(), claims.getStringClaim("execution_id"));
        assertEquals(context.nodeExecutionId().toString(), claims.getStringClaim("node_execution_id"));
        assertEquals(Date.from(now), claims.getIssueTime());
        assertEquals(Date.from(now.plusSeconds(60)), claims.getExpirationTime());
        assertNotNull(UUID.fromString(claims.getJWTID()));
    }

    @Test
    void contractVerifierRejectsWrongServiceClaimsEvenWhenTheyAreSigned() throws Exception {
        KeyPair keyPair = keyPair();
        Instant now = Instant.parse("2026-09-23T01:02:03Z");

        assertRejected(keyPair, now, "weav-api-gateway", "weav-ocr", "ocr:extract", "execution",
                context().workspaceId().toString());
        assertRejected(keyPair, now, "weav-workflow", "other-service", "ocr:extract", "execution",
                context().workspaceId().toString());
        assertRejected(keyPair, now, "weav-workflow", "weav-ocr", "workflow:execute", "execution",
                context().workspaceId().toString());
        assertRejected(keyPair, now, "weav-workflow", "weav-ocr", "ocr:extract", "preview",
                context().workspaceId().toString());
        assertRejected(keyPair, now, "weav-workflow", "weav-ocr", "ocr:extract", "execution",
                UUID.randomUUID().toString());
    }

    @Test
    void rejectsMissingExecutionIdentifiersExpiredTokensAndLifetimesOverContractMaximum() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID executionId = UUID.randomUUID();
        assertThrows(NullPointerException.class, () -> new NodeExecutor.Context(
                workspaceId, null, UUID.randomUUID(), "ocr", 1, null, null));
        assertThrows(NullPointerException.class, () -> new NodeExecutor.Context(
                workspaceId, executionId, null, "ocr", 1, null, null));

        KeyPair keyPair = keyPair();
        Path privateKey = writePrivateKey(keyPair);
        Instant issuedAt = Instant.parse("2026-09-23T01:02:03Z");
        SignedJWT valid = SignedJWT.parse(new WorkflowServiceJwtIssuer(
                properties(privateKey.toUri().toString(), Duration.ofSeconds(60)), new DefaultResourceLoader())
                .issue(context(), issuedAt));
        assertFalse(acceptsWorkflowToken(valid, keyPair, issuedAt.plusSeconds(61), context().workspaceId().toString()));

        assertThrows(IllegalArgumentException.class,
                () -> properties(privateKey.toUri().toString(), Duration.ofSeconds(121)));
    }

    @Test
    void refusesRemotePrivateKeyLocationsAndRsaKeysBelow2048Bits() throws Exception {
        NodeExecutor.Context context = context();
        WorkflowServiceJwtIssuer remoteKeyIssuer = new WorkflowServiceJwtIssuer(
                properties("https://keys.example.invalid/workflow.pem", Duration.ofSeconds(60)),
                new DefaultResourceLoader());
        NodeExecutor.Failure remoteKeyFailure = assertThrows(NodeExecutor.Failure.class,
                () -> remoteKeyIssuer.issue(context, Instant.now()));
        assertEquals("DEPENDENCY_NOT_CONFIGURED", remoteKeyFailure.code());

        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(1024);
        Path weakPrivateKey = writePrivateKey(generator.generateKeyPair());
        WorkflowServiceJwtIssuer weakKeyIssuer = new WorkflowServiceJwtIssuer(
                properties(weakPrivateKey.toUri().toString(), Duration.ofSeconds(60)),
                new DefaultResourceLoader());
        NodeExecutor.Failure weakKeyFailure = assertThrows(NodeExecutor.Failure.class,
                () -> weakKeyIssuer.issue(context, Instant.now()));
        assertEquals("DEPENDENCY_NOT_CONFIGURED", weakKeyFailure.code());
    }

    private void assertRejected(
            KeyPair keyPair,
            Instant now,
            String issuer,
            String audience,
            String scope,
            String mode,
            String workspaceId) throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(issuer)
                .audience(audience)
                .claim("scope", scope)
                .claim("workspace_id", workspaceId)
                .claim("mode", mode)
                .claim("execution_id", context().executionId().toString())
                .claim("node_execution_id", context().nodeExecutionId().toString())
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plusSeconds(60)))
                .jwtID(UUID.randomUUID().toString())
                .build();
        SignedJWT invalid = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256)
                .keyID("workflow-test-key").build(), claims);
        invalid.sign(new RSASSASigner((java.security.interfaces.RSAPrivateKey) keyPair.getPrivate()));

        assertFalse(acceptsWorkflowToken(invalid, keyPair, now, context().workspaceId().toString()));
    }

    private boolean acceptsWorkflowToken(SignedJWT token, KeyPair keyPair, Instant now, String expectedWorkspace)
            throws Exception {
        if (!token.verify(new RSASSAVerifier((java.security.interfaces.RSAPublicKey) keyPair.getPublic()))) {
            return false;
        }
        JWTClaimsSet claims = token.getJWTClaimsSet();
        Date issuedAt = claims.getIssueTime();
        Date expiresAt = claims.getExpirationTime();
        return "weav-workflow".equals(claims.getIssuer())
                && claims.getAudience().equals(java.util.List.of("weav-ocr"))
                && "ocr:extract".equals(claims.getStringClaim("scope"))
                && "execution".equals(claims.getStringClaim("mode"))
                && expectedWorkspace.equals(claims.getStringClaim("workspace_id"))
                && isUuid(claims.getStringClaim("execution_id"))
                && isUuid(claims.getStringClaim("node_execution_id"))
                && isUuid(claims.getJWTID())
                && issuedAt != null
                && expiresAt != null
                && expiresAt.toInstant().isAfter(now)
                && issuedAt.toInstant().isBefore(now.plusSeconds(1))
                && Duration.between(issuedAt.toInstant(), expiresAt.toInstant()).compareTo(Duration.ofSeconds(120)) <= 0;
    }

    private boolean isUuid(String value) {
        try {
            return value != null && UUID.fromString(value).toString().equalsIgnoreCase(value);
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private NodeExecutor.Context context() {
        return new NodeExecutor.Context(
                UUID.fromString("00000000-0000-0000-0000-000000000001"),
                UUID.fromString("00000000-0000-0000-0000-000000000002"),
                UUID.fromString("00000000-0000-0000-0000-000000000003"),
                "ocr-node", 1, null, null);
    }

    private KeyPair keyPair() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        return generator.generateKeyPair();
    }

    private Path writePrivateKey(KeyPair keyPair) throws Exception {
        String encoded = Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.US_ASCII))
                .encodeToString(keyPair.getPrivate().getEncoded());
        Path path = tempDir.resolve("workflow-test-private-key.pem");
        Files.writeString(path, "-----BEGIN PRIVATE KEY-----\n" + encoded + "\n-----END PRIVATE KEY-----\n");
        return path;
    }

    private OcrClientProperties properties(String privateKeyLocation, Duration tokenLifetime) {
        return new OcrClientProperties(
                true, true, true, true, true, true,
                java.net.URI.create("http://ocr.internal"), "workflow-test-key", privateKeyLocation,
                Duration.ofSeconds(5), Duration.ofSeconds(30), tokenLifetime, 1_048_576);
    }
}
