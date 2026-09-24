package com.weav.workflow.infrastructure.ocr;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.weav.workflow.application.node.NodeExecutor;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.interfaces.RSAPrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.Objects;
import java.util.UUID;

/** Mints one short-lived Workflow-to-OCR service JWT per node attempt. */
@Component
public final class WorkflowServiceJwtIssuer {

    private static final String ISSUER = "weav-workflow";
    private static final String AUDIENCE = "weav-ocr";
    private static final String SCOPE = "ocr:extract";

    private final OcrClientProperties properties;
    private final ResourceLoader resourceLoader;
    private volatile RSAPrivateKey signingKey;

    public WorkflowServiceJwtIssuer(OcrClientProperties properties, ResourceLoader resourceLoader) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.resourceLoader = Objects.requireNonNull(resourceLoader, "resourceLoader must not be null");
    }

    public String issue(NodeExecutor.Context context, Instant now) {
        if (context == null || now == null) {
            throw unavailable();
        }
        String keyId = properties.keyId();
        if (keyId == null || keyId.isBlank() || keyId.length() > 128 || hasControl(keyId)) {
            throw unavailable();
        }

        try {
            Instant expiresAt = now.plus(properties.tokenLifetime());
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .issuer(ISSUER)
                    .audience(AUDIENCE)
                    .claim("scope", SCOPE)
                    .claim("workspace_id", context.workspaceId().toString())
                    .claim("mode", "execution")
                    .claim("execution_id", context.executionId().toString())
                    .claim("node_execution_id", context.nodeExecutionId().toString())
                    .issueTime(Date.from(now))
                    .expirationTime(Date.from(expiresAt))
                    .jwtID(UUID.randomUUID().toString())
                    .build();
            JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
                    .type(JOSEObjectType.JWT)
                    .keyID(keyId)
                    .build();
            SignedJWT token = new SignedJWT(header, claims);
            token.sign(new RSASSASigner(signingKey()));
            return token.serialize();
        } catch (JOSEException | RuntimeException exception) {
            throw unavailable();
        }
    }

    private RSAPrivateKey signingKey() {
        RSAPrivateKey loaded = signingKey;
        if (loaded != null) {
            return loaded;
        }
        synchronized (this) {
            loaded = signingKey;
            if (loaded != null) {
                return loaded;
            }
            String location = properties.privateKeyLocation();
            if (location == null || location.isBlank() || hasControl(location) || !isLocalFileLocation(location)) {
                throw unavailable();
            }
            try {
                Resource resource = resourceLoader.getResource(location);
                byte[] pemBytes;
                try (var input = resource.getInputStream()) {
                    pemBytes = input.readNBytes(32 * 1024 + 1);
                }
                if (pemBytes.length > 32 * 1024) {
                    throw unavailable();
                }
                String pem = new String(pemBytes, StandardCharsets.US_ASCII).trim();
                if (!pem.startsWith("-----BEGIN PRIVATE KEY-----") || !pem.endsWith("-----END PRIVATE KEY-----")) {
                    throw unavailable();
                }
                String encoded = pem.replace("-----BEGIN PRIVATE KEY-----", "")
                        .replace("-----END PRIVATE KEY-----", "")
                        .replaceAll("\\s+", "");
                byte[] keyBytes = Base64.getDecoder().decode(encoded);
                loaded = (RSAPrivateKey) KeyFactory.getInstance("RSA")
                        .generatePrivate(new PKCS8EncodedKeySpec(keyBytes));
                if (loaded.getModulus().bitLength() < 2048) {
                    throw new java.security.GeneralSecurityException("RSA key is below the minimum strength");
                }
                signingKey = loaded;
                return loaded;
            } catch (IOException | java.security.GeneralSecurityException | IllegalArgumentException exception) {
                throw unavailable();
            }
        }
    }

    private NodeExecutor.Failure unavailable() {
        return new NodeExecutor.Failure(
                "DEPENDENCY_NOT_CONFIGURED", "OCR service authentication is not configured.", false);
    }

    private boolean isLocalFileLocation(String location) {
        try {
            URI uri = URI.create(location);
            return "file".equalsIgnoreCase(uri.getScheme()) && uri.isAbsolute()
                    && uri.getHost() == null && uri.getQuery() == null && uri.getFragment() == null
                    && uri.getPath() != null && !uri.getPath().isBlank();
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private boolean hasControl(String value) {
        return value.codePoints().anyMatch(character -> character < 0x20 || character == 0x7f);
    }
}
