package com.weav.identity.application.port.out;

import com.weav.identity.application.dto.OAuthClientRegistration;
import com.weav.identity.application.dto.OAuthSecret;
import com.weav.identity.domain.valueobject.OAuthProvider;
import com.weav.identity.application.validation.OAuthProtocolPolicy;

import java.net.URI;
import java.time.Instant;
import java.util.Objects;
import java.util.Set;

/**
 * Framework-free boundary for an OAuth provider adapter. The implementation
 * owns provider HTTP/OIDC details; application code receives only validated
 * provider identity data and never provider access or refresh tokens.
 */
public interface OAuthProviderClient {

    Set<String> AUTHORIZATION_SCOPES = Set.of("openid", "email", "profile");

    AuthorizationUrl buildAuthorizationUrl(AuthorizationRequest request);

    ProviderIdentity exchangeAuthorizationCode(AuthorizationCodeRequest request);

    record AuthorizationRequest(
            OAuthClientRegistration clientRegistration,
            OAuthSecret state,
            OAuthSecret nonce,
            OAuthSecret providerCodeVerifier
    ) {
        public AuthorizationRequest {
            Objects.requireNonNull(clientRegistration, "clientRegistration must not be null");
            Objects.requireNonNull(state, "state must not be null");
            Objects.requireNonNull(nonce, "nonce must not be null");
            Objects.requireNonNull(providerCodeVerifier, "providerCodeVerifier must not be null");
        }

        @Override
        public String toString() {
            return "AuthorizationRequest[clientRegistration=" + clientRegistration
                    + ", state=<redacted>, nonce=<redacted>, providerCodeVerifier=<redacted>]";
        }
    }

    record AuthorizationCodeRequest(
            OAuthClientRegistration clientRegistration,
            OAuthSecret authorizationCode,
            OAuthSecret providerCodeVerifier,
            String expectedNonceFingerprint
    ) {
        public AuthorizationCodeRequest {
            Objects.requireNonNull(clientRegistration, "clientRegistration must not be null");
            Objects.requireNonNull(authorizationCode, "authorizationCode must not be null");
            Objects.requireNonNull(providerCodeVerifier, "providerCodeVerifier must not be null");
            OAuthProtocolPolicy.requireOpaqueToken(expectedNonceFingerprint, "expectedNonceFingerprint");
        }

        @Override
        public String toString() {
            return "AuthorizationCodeRequest[clientRegistration=" + clientRegistration
                    + ", authorizationCode=<redacted>, providerCodeVerifier=<redacted>, expectedNonceFingerprint=<redacted>]";
        }
    }

    record AuthorizationUrl(URI value) {
        public AuthorizationUrl {
            Objects.requireNonNull(value, "value must not be null");
        }

        @Override
        public String toString() {
            return "AuthorizationUrl[value=<redacted>]";
        }
    }

    record ProviderIdentity(
            OAuthProvider provider,
            String providerSubject,
            String providerEmail,
            boolean emailVerified,
            String hostedDomain,
            Instant issuedAt,
            String displayName
    ) {
        public ProviderIdentity(
                OAuthProvider provider,
                String providerSubject,
                String providerEmail,
                boolean emailVerified,
                String hostedDomain,
                Instant issuedAt
        ) {
            this(provider, providerSubject, providerEmail, emailVerified, hostedDomain, issuedAt, null);
        }

        public ProviderIdentity {
            Objects.requireNonNull(provider, "provider must not be null");
            requireAscii(providerSubject, "providerSubject", 1, 255);
            if (providerEmail != null) {
                requireAscii(providerEmail, "providerEmail", 1, 254);
            }
            if (hostedDomain != null) {
                requireAscii(hostedDomain, "hostedDomain", 1, 253);
            }
            Objects.requireNonNull(issuedAt, "issuedAt must not be null");
            if (displayName != null) {
                requireDisplayName(displayName);
            }
        }

        @Override
        public String toString() {
            return "ProviderIdentity[provider=" + provider + ", providerSubject=<redacted>, providerEmail=<redacted>, emailVerified="
                    + emailVerified + ", hostedDomain=<redacted>, issuedAt=" + issuedAt + "]";
        }

        private static void requireAscii(String value, String name, int minimum, int maximum) {
            if (value == null || value.length() < minimum || value.length() > maximum
                    || value.isBlank()
                    || value.chars().anyMatch(character -> character < 0x20 || character > 0x7e)) {
                throw new IllegalArgumentException(name + " must be printable ASCII of length "
                        + minimum + ".." + maximum);
            }
        }

        private static void requireDisplayName(String value) {
            String normalized = value.strip();
            if (normalized.isEmpty() || normalized.length() > 120
                    || normalized.chars().anyMatch(Character::isISOControl)) {
                throw new IllegalArgumentException("displayName must contain 1..120 non-control characters");
            }
        }
    }
}
