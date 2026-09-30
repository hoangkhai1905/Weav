package com.weav.workflow.infrastructure.security;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.interfaces.RSAPrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public final class ServiceJwtSigner {
    private final ResourceLoader resourceLoader;
    private final String keyId;
    private final String privateKeyLocation;
    private final Duration tokenLifetime;
    private volatile RSAPrivateKey signingKey;

    public ServiceJwtSigner(ResourceLoader resourceLoader, String keyId, String privateKeyLocation,
                            Duration tokenLifetime) {
        this.resourceLoader = Objects.requireNonNull(resourceLoader, "resourceLoader must not be null");
        this.keyId = keyId;
        this.privateKeyLocation = privateKeyLocation;
        this.tokenLifetime = tokenLifetime;
    }

    public String sign(String issuer, String audience, Map<String, Object> claims, Instant now) {
        if (keyId == null || keyId.isBlank() || keyId.length() > 128 || hasControl(keyId)) {
            throw new Unavailable();
        }
        try {
            Instant expiresAt = now.plus(tokenLifetime);
            JWTClaimsSet.Builder claimsBuilder = new JWTClaimsSet.Builder()
                    .issuer(issuer)
                    .audience(audience);
            for (Map.Entry<String, Object> claim : claims.entrySet()) {
                claimsBuilder.claim(claim.getKey(), claim.getValue());
            }
            JWTClaimsSet jwtClaims = claimsBuilder
                    .issueTime(Date.from(now))
                    .expirationTime(Date.from(expiresAt))
                    .jwtID(UUID.randomUUID().toString())
                    .build();
            JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
                    .type(JOSEObjectType.JWT)
                    .keyID(keyId)
                    .build();
            SignedJWT token = new SignedJWT(header, jwtClaims);
            token.sign(new RSASSASigner(signingKey()));
            return token.serialize();
        } catch (Unavailable exception) {
            throw exception;
        } catch (JOSEException | RuntimeException exception) {
            throw new Unavailable();
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
            String location = privateKeyLocation;
            if (location == null || location.isBlank() || hasControl(location) || !isLocalFileLocation(location)) {
                throw new Unavailable();
            }
            try {
                Resource resource = resourceLoader.getResource(location);
                byte[] pemBytes;
                try (var input = resource.getInputStream()) {
                    pemBytes = input.readNBytes(32 * 1024 + 1);
                }
                if (pemBytes.length > 32 * 1024) {
                    throw new Unavailable();
                }
                String pem = new String(pemBytes, StandardCharsets.US_ASCII).trim();
                if (!pem.startsWith("-----BEGIN PRIVATE KEY-----") || !pem.endsWith("-----END PRIVATE KEY-----")) {
                    throw new Unavailable();
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
                throw new Unavailable();
            }
        }
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

    public static final class Unavailable extends RuntimeException {
        public Unavailable() {
            super(null, null, false, false);
        }
    }
}
