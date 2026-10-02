package com.weav.workspace.infrastructure.credential;

import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.infrastructure.config.CredentialEncryptionProperties;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * AES-256-GCM implementation for the credential crypto port, with a small key ring.
 *
 * <p>Stored envelope: one format byte, a random 12-byte nonce, then the GCM ciphertext with its 128-bit tag.
 * Format {@code 1} (legacy) has no AAD. Format {@code 2} (written today) authenticates the 16-byte big-endian
 * connection UUID as AAD, so a payload moved to another connection fails to decrypt.</p>
 *
 * <p>Keys: the current key encrypts everything new. Retired keys come from {@code previousKeys}
 * ({@code version:base64,version:base64}). Decrypt selects the key by the key version stored beside the
 * payload; an unknown version on a format-2 payload fails closed. Legacy format-1 payloads fall back to the
 * current key when their stored version is not in the ring (they were all written under the one key).
 * Re-encryption is lazy: any credential write uses the current key and format 2.</p>
 */
public final class AesGcmCredentialCrypto implements CredentialCryptoPort {

    private static final int FORMAT_LEGACY_NO_AAD = 1;
    private static final int FORMAT_CONNECTION_AAD = 2;
    private static final int NONCE_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final int TAG_BYTES = TAG_BITS / Byte.SIZE;
    private static final int MIN_ENVELOPE_BYTES = 1 + NONCE_BYTES + TAG_BYTES;
    private static final int AES_KEY_BYTES = 32;

    private final SecretKeySpec currentKey;
    private final String keyVersion;
    private final Map<String, SecretKeySpec> keyRing = new HashMap<>();
    private final SecureRandom secureRandom;

    public AesGcmCredentialCrypto(CredentialEncryptionProperties properties) {
        Objects.requireNonNull(properties, "properties must not be null");
        this.currentKey = new SecretKeySpec(decodeKey(properties.encryptionKey()), "AES");
        this.keyVersion = properties.encryptionKeyVersion();
        keyRing.put(keyVersion, currentKey);
        parsePreviousKeys(properties.previousKeys());
        this.secureRandom = new SecureRandom();
    }

    @Override
    public byte[] encrypt(byte[] plaintext, UUID connectionId) {
        if (plaintext == null || connectionId == null) {
            throw new IllegalArgumentException("Credential plaintext and connection id must not be null");
        }

        byte[] nonce = new byte[NONCE_BYTES];
        secureRandom.nextBytes(nonce);
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, currentKey, new GCMParameterSpec(TAG_BITS, nonce));
            cipher.updateAAD(aad(connectionId));
            byte[] ciphertext = cipher.doFinal(plaintext);
            ByteBuffer envelope = ByteBuffer.allocate(1 + nonce.length + ciphertext.length);
            envelope.put((byte) FORMAT_CONNECTION_AAD);
            envelope.put(nonce);
            envelope.put(ciphertext);
            return envelope.array();
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Credential encryption failed", exception);
        }
    }

    @Override
    public byte[] decrypt(byte[] encryptedPayload, String storedKeyVersion, UUID connectionId) {
        if (encryptedPayload == null || encryptedPayload.length < MIN_ENVELOPE_BYTES || connectionId == null) {
            throw invalidEnvelope();
        }
        int format = Byte.toUnsignedInt(encryptedPayload[0]);
        if (format != FORMAT_LEGACY_NO_AAD && format != FORMAT_CONNECTION_AAD) {
            throw invalidEnvelope();
        }
        SecretKeySpec key = storedKeyVersion == null ? null : keyRing.get(storedKeyVersion);
        if (key == null && format == FORMAT_LEGACY_NO_AAD) {
            key = currentKey;
        }
        if (key == null) {
            throw invalidEnvelope();
        }

        byte[] nonce = new byte[NONCE_BYTES];
        System.arraycopy(encryptedPayload, 1, nonce, 0, NONCE_BYTES);
        byte[] ciphertext = new byte[encryptedPayload.length - 1 - NONCE_BYTES];
        System.arraycopy(encryptedPayload, 1 + NONCE_BYTES, ciphertext, 0, ciphertext.length);
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, nonce));
            if (format == FORMAT_CONNECTION_AAD) {
                cipher.updateAAD(aad(connectionId));
            }
            return cipher.doFinal(ciphertext);
        } catch (GeneralSecurityException exception) {
            throw invalidEnvelope();
        }
    }

    @Override
    public String currentKeyVersion() {
        return keyVersion;
    }

    private void parsePreviousKeys(String previousKeys) {
        if (previousKeys == null || previousKeys.isBlank()) {
            return;
        }
        for (String entry : previousKeys.split(",")) {
            int separator = entry.indexOf(':');
            String version = separator < 0 ? "" : entry.substring(0, separator).trim();
            if (version.isEmpty() || keyRing.containsKey(version)) {
                // Deliberately never echo the entry: it contains key material.
                throw new IllegalArgumentException(
                        "credential previous keys must be unique version:base64key pairs");
            }
            keyRing.put(version, new SecretKeySpec(decodeKey(entry.substring(separator + 1).trim()), "AES"));
        }
    }

    private static byte[] aad(UUID connectionId) {
        return ByteBuffer.allocate(16)
                .putLong(connectionId.getMostSignificantBits())
                .putLong(connectionId.getLeastSignificantBits())
                .array();
    }

    private static byte[] decodeKey(String encodedKey) {
        final byte[] decoded;
        try {
            decoded = Base64.getDecoder().decode(encodedKey);
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException(
                    "credential encryption key must be valid Base64 for exactly 32 bytes");
        }
        if (decoded.length != AES_KEY_BYTES) {
            throw new IllegalArgumentException(
                    "credential encryption key must be valid Base64 for exactly 32 bytes");
        }
        return decoded;
    }

    private static IllegalArgumentException invalidEnvelope() {
        return new IllegalArgumentException("Credential ciphertext is invalid");
    }
}
