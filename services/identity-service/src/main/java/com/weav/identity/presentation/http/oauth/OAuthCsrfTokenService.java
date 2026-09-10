package com.weav.identity.presentation.http.oauth;

import com.weav.identity.application.dto.OAuthConfiguration;
import com.weav.identity.application.port.out.KeyedFingerprint;
import org.springframework.stereotype.Component;

import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.Arrays;
import java.util.Base64;
import java.util.Objects;

/**
 * Issues a bounded, signed double-submit value for the browser OAuth routes.
 * The token remains exactly one opaque 32-byte base64url value: sixteen bytes
 * carry an issued-at timestamp and random nonce, and sixteen bytes carry a
 * truncated domain-separated HMAC. No server-side session state is required,
 * but an attacker cannot choose an arbitrary cookie/header pair that verifies.
 */
@Component
public final class OAuthCsrfTokenService {

    private static final String FINGERPRINT_NAMESPACE = "oauth-csrf-token";
    private static final int PAYLOAD_BYTES = 16;
    private static final int MAC_BYTES = 16;
    private static final int TOKEN_BYTES = PAYLOAD_BYTES + MAC_BYTES;
    private static final int TOKEN_LENGTH = 43;

    private final OAuthConfiguration configuration;
    private final KeyedFingerprint fingerprint;
    private final SecureRandom secureRandom;
    private final Clock clock;

    public OAuthCsrfTokenService(
            OAuthConfiguration configuration,
            KeyedFingerprint fingerprint,
            SecureRandom secureRandom,
            Clock clock
    ) {
        this.configuration = Objects.requireNonNull(configuration, "configuration must not be null");
        this.fingerprint = Objects.requireNonNull(fingerprint, "fingerprint must not be null");
        this.secureRandom = Objects.requireNonNull(secureRandom, "secureRandom must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    public String issue() {
        byte[] payload = new byte[PAYLOAD_BYTES];
        ByteBuffer.wrap(payload).putLong(clock.instant().getEpochSecond());
        byte[] random = new byte[PAYLOAD_BYTES - Long.BYTES];
        secureRandom.nextBytes(random);
        System.arraycopy(random, 0, payload, Long.BYTES, random.length);

        byte[] token = new byte[TOKEN_BYTES];
        System.arraycopy(payload, 0, token, 0, payload.length);
        byte[] mac = mac(payload);
        System.arraycopy(mac, 0, token, PAYLOAD_BYTES, MAC_BYTES);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(token);
    }

    public boolean isValid(String token) {
        if (token == null) {
            return false;
        }
        if (token.length() != TOKEN_LENGTH) {
            return false;
        }
        try {
            byte[] decoded = Base64.getUrlDecoder().decode(token);
            if (decoded.length != TOKEN_BYTES
                    || !token.equals(Base64.getUrlEncoder().withoutPadding().encodeToString(decoded))) {
                return false;
            }
            byte[] payload = Arrays.copyOf(decoded, PAYLOAD_BYTES);
            byte[] suppliedMac = Arrays.copyOfRange(decoded, PAYLOAD_BYTES, TOKEN_BYTES);
            if (!MessageDigest.isEqual(suppliedMac, Arrays.copyOf(mac(payload), MAC_BYTES))) {
                return false;
            }
            long issuedAt = ByteBuffer.wrap(payload, 0, Long.BYTES).getLong();
            long now = clock.instant().getEpochSecond();
            long ttl = configuration.csrfTtl().toSeconds();
            return issuedAt <= now && now - issuedAt < ttl;
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private byte[] mac(byte[] payload) {
        String encodedPayload = Base64.getUrlEncoder().withoutPadding().encodeToString(payload);
        return Base64.getUrlDecoder().decode(fingerprint.fingerprint(FINGERPRINT_NAMESPACE, encodedPayload));
    }
}
