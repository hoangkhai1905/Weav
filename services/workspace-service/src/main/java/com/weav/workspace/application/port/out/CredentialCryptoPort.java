package com.weav.workspace.application.port.out;

/**
 * Encrypts credential payloads before they cross the persistence boundary.
 *
 * <p>The application only handles opaque bytes. Key material and the concrete
 * envelope are infrastructure concerns.</p>
 */
public interface CredentialCryptoPort {

    byte[] encrypt(byte[] plaintext);

    byte[] decrypt(byte[] encryptedPayload);

    String currentKeyVersion();
}
