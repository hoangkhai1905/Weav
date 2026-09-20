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
import java.util.Objects;

/**
 * AES-256-GCM implementation for the credential crypto port.
 *
 * <p>The stored format is one format byte, a random 12-byte nonce, and the
 * GCM ciphertext including its 128-bit authentication tag. The stored key
 * version is metadata for future rotation; V1 decrypts with the configured
 * current key because the port deliberately has no version argument.</p>
 */
public final class AesGcmCredentialCrypto implements CredentialCryptoPort {

    private static final int FORMAT_VERSION = 1;
    private static final int NONCE_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final int TAG_BYTES = TAG_BITS / Byte.SIZE;
    private static final int MIN_ENVELOPE_BYTES = 1 + NONCE_BYTES + TAG_BYTES;
    private static final int AES_KEY_BYTES = 32;

    private final SecretKeySpec key;
    private final String keyVersion;
    private final SecureRandom secureRandom;

    public AesGcmCredentialCrypto(CredentialEncryptionProperties properties) {
        Objects.requireNonNull(properties, "properties must not be null");
        this.key = new SecretKeySpec(decodeKey(properties.encryptionKey()), "AES");
        this.keyVersion = properties.encryptionKeyVersion();
        this.secureRandom = new SecureRandom();
    }

    @Override
    public byte[] encrypt(byte[] plaintext) {
        if (plaintext == null) {
            throw new IllegalArgumentException("Credential plaintext must not be null");
        }

        byte[] nonce = new byte[NONCE_BYTES];
        secureRandom.nextBytes(nonce);
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, nonce));
            byte[] ciphertext = cipher.doFinal(plaintext);
            ByteBuffer envelope = ByteBuffer.allocate(1 + nonce.length + ciphertext.length);
            envelope.put((byte) FORMAT_VERSION);
            envelope.put(nonce);
            envelope.put(ciphertext);
            return envelope.array();
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Credential encryption failed", exception);
        }
    }

    @Override
    public byte[] decrypt(byte[] encryptedPayload) {
        if (encryptedPayload == null || encryptedPayload.length < MIN_ENVELOPE_BYTES) {
            throw invalidEnvelope();
        }
        if (Byte.toUnsignedInt(encryptedPayload[0]) != FORMAT_VERSION) {
            throw invalidEnvelope();
        }

        byte[] nonce = new byte[NONCE_BYTES];
        System.arraycopy(encryptedPayload, 1, nonce, 0, NONCE_BYTES);
        byte[] ciphertext = new byte[encryptedPayload.length - 1 - NONCE_BYTES];
        System.arraycopy(encryptedPayload, 1 + NONCE_BYTES, ciphertext, 0, ciphertext.length);
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, nonce));
            return cipher.doFinal(ciphertext);
        } catch (GeneralSecurityException exception) {
            throw invalidEnvelope();
        }
    }

    @Override
    public String currentKeyVersion() {
        return keyVersion;
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
