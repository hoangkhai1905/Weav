package com.weav.workspace.application.port.out;

import java.util.UUID;

/**
 * Encrypts credential payloads before they cross the persistence boundary.
 *
 * <p>The application only handles opaque bytes. Key material and the concrete
 * envelope are infrastructure concerns. Ciphertexts are bound to their
 * connection id, so a payload copied to another connection does not decrypt.</p>
 */
public interface CredentialCryptoPort {

    /** Encrypts with the current key; the result must be stored with {@link #currentKeyVersion()}. */
    byte[] encrypt(byte[] plaintext, UUID connectionId);

    /** Decrypts with the key named by {@code keyVersion} (the version stored beside the payload). */
    byte[] decrypt(byte[] encryptedPayload, String keyVersion, UUID connectionId);

    String currentKeyVersion();
}
