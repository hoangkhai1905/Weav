package com.weav.identity.infrastructure.security;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.RSAPublicKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * Loads the RS256 signing key (private PEM) and an optional previous public key for rotation.
 * Error messages never include key material.
 */
public final class JwtSigningKeys {

    private static final int MIN_RSA_BITS = 2048;

    private final RSAKey current;
    private final JWKSet publicSet;

    private JwtSigningKeys(RSAKey current, JWKSet publicSet) {
        this.current = current;
        this.publicSet = publicSet;
    }

    /** Signing key with private part; null when no key is configured (HS256 only). */
    public RSAKey current() {
        return current;
    }

    /** Public keys only (current plus previous). Safe to serve. */
    public JWKSet publicSet() {
        return publicSet;
    }

    public static JwtSigningKeys load(JwtSigningProperties p) {
        List<JWK> publicKeys = new ArrayList<>();
        RSAKey current = null;
        // Under HS256 a key file that is absent (dev compose always sets the path) means "no key".
        boolean hasKey = hasText(p.keyLocation()) && (p.rs256() || Files.exists(Path.of(p.keyLocation())));
        if (p.rs256() && !hasKey) {
            throw new IllegalStateException("JWT_ACCESS_ALG=RS256 requires JWT_SIGNING_KEY_LOCATION");
        }
        if (hasKey) {
            if (!hasText(p.keyId())) {
                throw new IllegalStateException("JWT_SIGNING_KEY_ID is required with JWT_SIGNING_KEY_LOCATION");
            }
            try {
                var priv = (RSAPrivateCrtKey) KeyFactory.getInstance("RSA")
                        .generatePrivate(new PKCS8EncodedKeySpec(pem(p.keyLocation())));
                var pub = (RSAPublicKey) KeyFactory.getInstance("RSA")
                        .generatePublic(new RSAPublicKeySpec(priv.getModulus(), priv.getPublicExponent()));
                requireStrong(pub);
                current = new RSAKey.Builder(pub).privateKey(priv).keyID(p.keyId())
                        .keyUse(KeyUse.SIGNATURE).algorithm(JWSAlgorithm.RS256).build();
                publicKeys.add(current.toPublicJWK());
            } catch (IOException | GeneralSecurityException | ClassCastException | IllegalArgumentException e) {
                throw new IllegalStateException(
                        "JWT_SIGNING_KEY_LOCATION is not a readable PKCS#8 RSA private key PEM");
            }
        }
        if (hasText(p.previousPublicKeyLocation())) {
            if (!hasText(p.previousKeyId())) {
                throw new IllegalStateException(
                        "JWT_PREVIOUS_KEY_ID is required with JWT_PREVIOUS_PUBLIC_KEY_LOCATION");
            }
            try {
                var pub = (RSAPublicKey) KeyFactory.getInstance("RSA")
                        .generatePublic(new X509EncodedKeySpec(pem(p.previousPublicKeyLocation())));
                requireStrong(pub);
                publicKeys.add(new RSAKey.Builder(pub).keyID(p.previousKeyId())
                        .keyUse(KeyUse.SIGNATURE).algorithm(JWSAlgorithm.RS256).build());
            } catch (IOException | GeneralSecurityException | ClassCastException | IllegalArgumentException e) {
                throw new IllegalStateException(
                        "JWT_PREVIOUS_PUBLIC_KEY_LOCATION is not a readable X.509 RSA public key PEM");
            }
        }
        return new JwtSigningKeys(current, new JWKSet(publicKeys));
    }

    private static void requireStrong(RSAPublicKey key) {
        if (key.getModulus().bitLength() < MIN_RSA_BITS) {
            throw new IllegalStateException("JWT RSA key must be at least " + MIN_RSA_BITS + " bits");
        }
    }

    private static byte[] pem(String location) throws IOException {
        String body = Files.readString(Path.of(location))
                .replaceAll("-----(BEGIN|END)[A-Z ]+-----", "")
                .replaceAll("\\s", "");
        return Base64.getDecoder().decode(body);
    }

    private static boolean hasText(String s) {
        return s != null && !s.isBlank();
    }
}
