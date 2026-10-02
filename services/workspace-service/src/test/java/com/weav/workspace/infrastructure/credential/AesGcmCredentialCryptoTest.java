package com.weav.workspace.infrastructure.credential;

import com.weav.workspace.infrastructure.config.CredentialEncryptionProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Configuration;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.UUID;
import java.util.Arrays;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@ExtendWith(OutputCaptureExtension.class)
class AesGcmCredentialCryptoTest {

    private static final String KEY = Base64.getEncoder().encodeToString(new byte[] {
            0, 1, 2, 3, 4, 5, 6, 7,
            8, 9, 10, 11, 12, 13, 14, 15,
            16, 17, 18, 19, 20, 21, 22, 23,
            24, 25, 26, 27, 28, 29, 30, 31});
    private static final String OTHER_KEY = Base64.getEncoder().encodeToString(new byte[] {
            31, 30, 29, 28, 27, 26, 25, 24,
            23, 22, 21, 20, 19, 18, 17, 16,
            15, 14, 13, 12, 11, 10, 9, 8,
            7, 6, 5, 4, 3, 2, 1, 0});

    private static final UUID CONNECTION = UUID.fromString("11111111-2222-3333-4444-555555555555");
    private static final UUID OTHER_CONNECTION = UUID.fromString("66666666-7777-8888-9999-000000000000");

    @Test
    void encryptDecryptRoundTripUsesVersionedEnvelopeWithConnectionAad() {
        AesGcmCredentialCrypto crypto = crypto(KEY, "v7");
        byte[] plaintext = "credential-json".getBytes(StandardCharsets.UTF_8);

        byte[] encrypted = crypto.encrypt(plaintext, CONNECTION);

        assertThat(encrypted).hasSize(1 + 12 + plaintext.length + 16);
        assertThat(encrypted[0]).isEqualTo((byte) 2);
        assertThat(crypto.currentKeyVersion()).isEqualTo("v7");
        assertThat(crypto.decrypt(encrypted, "v7", CONNECTION)).containsExactly(plaintext);
    }

    @Test
    void ciphertextDecryptsOnlyForItsOwnConnection() {
        AesGcmCredentialCrypto crypto = crypto(KEY, "v1");
        byte[] encrypted = crypto.encrypt("secret-value".getBytes(StandardCharsets.UTF_8), CONNECTION);

        assertThatThrownBy(() -> crypto.decrypt(encrypted, "v1", OTHER_CONNECTION))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Credential ciphertext is invalid");
    }

    @Test
    void legacyNoAadCiphertextStillDecryptsWithCurrentKey() throws Exception {
        byte[] plaintext = "legacy-value".getBytes(StandardCharsets.UTF_8);
        byte[] legacy = legacyEnvelope(KEY, plaintext);

        // Legacy rows carry whatever version was stored; they must decrypt with any connection id.
        assertThat(crypto(KEY, "v1").decrypt(legacy, "v1", CONNECTION)).containsExactly(plaintext);
        assertThat(crypto(KEY, "v2").decrypt(legacy, "v1", OTHER_CONNECTION)).containsExactly(plaintext);
    }

    @Test
    void rotatedKeyDecryptsOldDataFromPreviousKeysAndNextWriteUsesCurrentKey() {
        byte[] plaintext = "rotating-value".getBytes(StandardCharsets.UTF_8);
        byte[] oldCiphertext = crypto(KEY, "v1").encrypt(plaintext, CONNECTION);

        AesGcmCredentialCrypto rotated = ringCrypto(OTHER_KEY, "v2", "v1:" + KEY);

        assertThat(rotated.decrypt(oldCiphertext, "v1", CONNECTION)).containsExactly(plaintext);
        byte[] rewritten = rotated.encrypt(plaintext, CONNECTION);
        assertThat(rotated.currentKeyVersion()).isEqualTo("v2");
        assertThat(rotated.decrypt(rewritten, "v2", CONNECTION)).containsExactly(plaintext);
        // The rewritten payload no longer needs the retired key.
        assertThat(crypto(OTHER_KEY, "v2").decrypt(rewritten, "v2", CONNECTION)).containsExactly(plaintext);
    }

    @Test
    void unknownKeyVersionFailsClosedWithoutPreviousKey() {
        byte[] oldCiphertext = crypto(KEY, "v1").encrypt("secret-value".getBytes(StandardCharsets.UTF_8), CONNECTION);

        assertThatThrownBy(() -> crypto(OTHER_KEY, "v2").decrypt(oldCiphertext, "v1", CONNECTION))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Credential ciphertext is invalid")
                .hasMessageNotContaining("secret-value");
        assertThatThrownBy(() -> crypto(KEY, "v1").decrypt(oldCiphertext, null, CONNECTION))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void invalidPreviousKeysFailConstructionWithoutEchoingKeyMaterial() {
        for (String bad : new String[] {"nocolon", ":" + KEY, "v1:" + KEY, "v0:not-base64", "v0:" + Base64.getEncoder().encodeToString(new byte[8])}) {
            assertThatThrownBy(() -> ringCrypto(KEY, "v1", bad))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageNotContaining(KEY);
        }
    }

    @Test
    void samePlaintextProducesDifferentCiphertext() {
        AesGcmCredentialCrypto crypto = crypto(KEY, "v1");
        byte[] plaintext = "same-value".getBytes(StandardCharsets.UTF_8);

        assertThat(crypto.encrypt(plaintext, CONNECTION)).isNotEqualTo(crypto.encrypt(plaintext, CONNECTION));
    }

    @Test
    void tamperedTruncatedAndUnknownFormatEnvelopesFailWithoutPayloadDetails() {
        AesGcmCredentialCrypto crypto = crypto(KEY, "v1");
        byte[] encrypted = crypto.encrypt("secret-value".getBytes(StandardCharsets.UTF_8), CONNECTION);

        byte[] tampered = encrypted.clone();
        tampered[tampered.length - 1] ^= 1;
        byte[] truncated = Arrays.copyOf(encrypted, encrypted.length - 1);
        byte[] unknownFormat = encrypted.clone();
        unknownFormat[0] = 3;

        for (byte[] candidate : new byte[][] {tampered, truncated, unknownFormat}) {
            assertThatThrownBy(() -> crypto.decrypt(candidate, "v1", CONNECTION))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessage("Credential ciphertext is invalid")
                    .hasMessageNotContaining("secret-value");
        }
    }

    @Test
    void wrongKeyFailsWithoutLeakingPlaintext() {
        byte[] encrypted = crypto(KEY, "v1").encrypt("secret-value".getBytes(StandardCharsets.UTF_8), CONNECTION);

        assertThatThrownBy(() -> crypto(OTHER_KEY, "v1").decrypt(encrypted, "v1", CONNECTION))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Credential ciphertext is invalid")
                .hasMessageNotContaining("secret-value");
    }

    private static byte[] legacyEnvelope(String base64Key, byte[] plaintext) throws Exception {
        byte[] nonce = new byte[12];
        new SecureRandom().nextBytes(nonce);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(Base64.getDecoder().decode(base64Key), "AES"),
                new GCMParameterSpec(128, nonce));
        byte[] ciphertext = cipher.doFinal(plaintext);
        return ByteBuffer.allocate(1 + nonce.length + ciphertext.length)
                .put((byte) 1).put(nonce).put(ciphertext).array();
    }

    private static AesGcmCredentialCrypto ringCrypto(String key, String version, String previousKeys) {
        return new AesGcmCredentialCrypto(new CredentialEncryptionProperties(key, version, previousKeys));
    }

    @Test
    void invalidOrMissingKeyFailsConfigurationConstruction() {
        assertThatThrownBy(() -> crypto("not-base64", "v1"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("credential encryption key must be valid Base64 for exactly 32 bytes");
        assertThatThrownBy(() -> crypto(Base64.getEncoder().encodeToString(new byte[31]), "v1"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("credential encryption key must be valid Base64 for exactly 32 bytes");
        assertThatThrownBy(() -> new CredentialEncryptionProperties(null, "v1"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("credential encryption key must not be blank");
    }

    @Test
    void springPropertyBindingRejectsMissingMalformedAndShortKeysWithoutSecretDiagnostics(
            CapturedOutput output) {
        String malformedKey = "synthetic-not-base64-key";
        String shortKey = Base64.getEncoder().encodeToString(new byte[31]);

        assertStartupFailure(null, null);
        assertStartupFailure(malformedKey, malformedKey);
        assertStartupFailure(shortKey, shortKey);

        assertThat(output.getAll())
                .doesNotContain(malformedKey)
                .doesNotContain(shortKey);
    }

    private static void assertStartupFailure(String encryptionKey, String forbiddenDiagnostic) {
        ApplicationContextRunner runner = new ApplicationContextRunner()
                .withUserConfiguration(CredentialPropertiesConfiguration.class);
        if (encryptionKey != null) {
            runner = runner.withPropertyValues(
                    "weav.credential.encryption-key=" + encryptionKey,
                    "weav.credential.encryption-key-version=test-v1");
        }

        runner.run(context -> {
            assertThat(context).hasFailed();
            Throwable startupFailure = context.getStartupFailure();
            assertThat(startupFailure).isNotNull();
            String diagnostics = diagnostics(startupFailure);
            if (forbiddenDiagnostic != null) {
                assertThat(diagnostics).doesNotContain(forbiddenDiagnostic);
            }
        });
    }

    private static String diagnostics(Throwable failure) {
        StringBuilder diagnostics = new StringBuilder();
        for (Throwable current = failure; current != null; current = current.getCause()) {
            diagnostics.append(current).append('\n');
        }
        return diagnostics.toString();
    }

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(CredentialEncryptionProperties.class)
    static class CredentialPropertiesConfiguration {
    }

    private static AesGcmCredentialCrypto crypto(String key, String version) {
        return new AesGcmCredentialCrypto(new CredentialEncryptionProperties(key, version));
    }
}
