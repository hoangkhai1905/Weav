package com.weav.workspace.infrastructure.credential;

import com.weav.workspace.infrastructure.config.CredentialEncryptionProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Configuration;

import java.nio.charset.StandardCharsets;
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

    @Test
    void encryptDecryptRoundTripUsesVersionedEnvelope() {
        AesGcmCredentialCrypto crypto = crypto(KEY, "v7");
        byte[] plaintext = "credential-json".getBytes(StandardCharsets.UTF_8);

        byte[] encrypted = crypto.encrypt(plaintext);

        assertThat(encrypted).hasSize(1 + 12 + plaintext.length + 16);
        assertThat(encrypted[0]).isEqualTo((byte) 1);
        assertThat(crypto.currentKeyVersion()).isEqualTo("v7");
        assertThat(crypto.decrypt(encrypted)).containsExactly(plaintext);
    }

    @Test
    void samePlaintextProducesDifferentCiphertext() {
        AesGcmCredentialCrypto crypto = crypto(KEY, "v1");
        byte[] plaintext = "same-value".getBytes(StandardCharsets.UTF_8);

        assertThat(crypto.encrypt(plaintext)).isNotEqualTo(crypto.encrypt(plaintext));
    }

    @Test
    void tamperedTruncatedAndUnknownVersionEnvelopesFailWithoutPayloadDetails() {
        AesGcmCredentialCrypto crypto = crypto(KEY, "v1");
        byte[] encrypted = crypto.encrypt("secret-value".getBytes(StandardCharsets.UTF_8));

        byte[] tampered = encrypted.clone();
        tampered[tampered.length - 1] ^= 1;
        byte[] truncated = Arrays.copyOf(encrypted, encrypted.length - 1);
        byte[] unknownVersion = encrypted.clone();
        unknownVersion[0] = 2;

        for (byte[] candidate : new byte[][] {tampered, truncated, unknownVersion}) {
            assertThatThrownBy(() -> crypto.decrypt(candidate))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessage("Credential ciphertext is invalid")
                    .hasMessageNotContaining("secret-value");
        }
    }

    @Test
    void wrongKeyFailsWithoutLeakingPlaintext() {
        byte[] encrypted = crypto(KEY, "v1").encrypt("secret-value".getBytes(StandardCharsets.UTF_8));

        assertThatThrownBy(() -> crypto(OTHER_KEY, "v1").decrypt(encrypted))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Credential ciphertext is invalid")
                .hasMessageNotContaining("secret-value");
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
