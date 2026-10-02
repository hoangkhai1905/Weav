package com.weav.workspace.infrastructure.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.ConstructorBinding;

import java.util.Base64;

/**
 * {@code previousKeys} is an optional {@code version:base64key,version:base64key} list of retired keys
 * that stored credentials may still be encrypted with; parsed and validated by the crypto at startup.
 */
@ConfigurationProperties(prefix = "weav.credential")
public record CredentialEncryptionProperties(String encryptionKey, String encryptionKeyVersion, String previousKeys) {

    private static final int AES_KEY_BYTES = 32;
    private static final String INVALID_KEY_MESSAGE =
            "credential encryption key must be valid Base64 for exactly 32 bytes";

    @ConstructorBinding
    public CredentialEncryptionProperties {
        if (encryptionKey == null || encryptionKey.isBlank()) {
            throw new IllegalArgumentException("credential encryption key must not be blank");
        }
        validateKey(encryptionKey);
        encryptionKeyVersion = encryptionKeyVersion == null ? "v1" : encryptionKeyVersion;
        if (encryptionKeyVersion.isBlank()) {
            throw new IllegalArgumentException("credential encryption key version must not be blank");
        }
        previousKeys = previousKeys == null ? "" : previousKeys;
    }

    public CredentialEncryptionProperties(String encryptionKey, String encryptionKeyVersion) {
        this(encryptionKey, encryptionKeyVersion, "");
    }

    @Override
    public String toString() {
        return "CredentialEncryptionProperties[encryptionKey=<redacted>, encryptionKeyVersion="
                + encryptionKeyVersion + ", previousKeys=<redacted>]";
    }

    private static void validateKey(String encodedKey) {
        try {
            if (Base64.getDecoder().decode(encodedKey).length != AES_KEY_BYTES) {
                throw invalidKey();
            }
        } catch (IllegalArgumentException exception) {
            throw invalidKey();
        }
    }

    private static IllegalArgumentException invalidKey() {
        return new IllegalArgumentException(INVALID_KEY_MESSAGE);
    }
}
