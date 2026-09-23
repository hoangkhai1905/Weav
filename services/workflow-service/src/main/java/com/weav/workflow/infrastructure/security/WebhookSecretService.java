package com.weav.workflow.infrastructure.security;

import com.weav.workflow.application.port.out.WebhookSecretPort;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Objects;

/** Creates random public endpoint identifiers and high-entropy secrets; only SHA-256 verifiers are persisted. */
@Service
public final class WebhookSecretService implements WebhookSecretPort {
    private static final int ENDPOINT_KEY_BYTES = 24;
    private static final int SECRET_BYTES = 32;
    private static final int SHA256_BYTES = 32;

    private final SecureRandom secureRandom;

    public WebhookSecretService() {
        this(new SecureRandom());
    }

    WebhookSecretService(SecureRandom secureRandom) {
        this.secureRandom = Objects.requireNonNull(secureRandom, "secureRandom must not be null");
    }

    @Override
    public IssuedKey provision() {
        byte[] endpointBytes = new byte[ENDPOINT_KEY_BYTES];
        byte[] secretBytes = new byte[SECRET_BYTES];
        secureRandom.nextBytes(endpointBytes);
        secureRandom.nextBytes(secretBytes);
        String endpointKey = Base64.getUrlEncoder().withoutPadding().encodeToString(endpointBytes);
        String secret = Base64.getUrlEncoder().withoutPadding().encodeToString(secretBytes);
        return new IssuedKey(endpointKey, secret, HexFormat.of().formatHex(digest(secret.getBytes(StandardCharsets.UTF_8))));
    }

    @Override
    public boolean matches(String supplied, String storedHash) {
        byte[] actual = supplied != null && supplied.length() <= 128
                ? digest(supplied.getBytes(StandardCharsets.UTF_8))
                : digest(new byte[0]);
        byte[] expected = parseHashOrDummy(storedHash);
        return MessageDigest.isEqual(actual, expected);
    }

    private byte[] parseHashOrDummy(String encodedHash) {
        if (encodedHash == null || encodedHash.length() != SHA256_BYTES * 2) {
            return new byte[SHA256_BYTES];
        }
        try {
            byte[] decoded = HexFormat.of().parseHex(encodedHash);
            return decoded.length == SHA256_BYTES ? decoded : new byte[SHA256_BYTES];
        } catch (IllegalArgumentException exception) {
            return new byte[SHA256_BYTES];
        }
    }

    private byte[] digest(byte[] value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value);
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
