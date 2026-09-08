package com.weav.identity.infrastructure.authstate;

import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.domain.exception.DependencyUnavailableException;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Base64;

/** HMAC-SHA-256 fingerprinting with explicit namespace separation. */
public final class HmacKeyedFingerprint implements KeyedFingerprint {

    private static final String ALGORITHM = "HmacSHA256";
    private final byte[] secret;

    public HmacKeyedFingerprint(String secret) {
        byte[] candidate = secret == null ? null : secret.getBytes(StandardCharsets.UTF_8);
        this.secret = candidate == null || secret.isBlank() || candidate.length < 32 ? null : candidate.clone();
    }

    @Override
    public String fingerprint(String namespace, String value) {
        if (secret == null || secret.length == 0) {
            throw new DependencyUnavailableException();
        }
        if (namespace == null || namespace.isBlank() || namespace.indexOf('\u0000') >= 0 || value == null) {
            throw new IllegalArgumentException("fingerprint namespace and value are required");
        }
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(secret, ALGORITHM));
            byte[] separated = (namespace + "\u0000" + value).getBytes(StandardCharsets.UTF_8);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(separated));
        } catch (GeneralSecurityException exception) {
            throw new DependencyUnavailableException();
        }
    }
}
