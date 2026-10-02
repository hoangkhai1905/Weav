package com.weav.identity.application.dto;

import java.net.URI;
import java.time.Duration;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * Validated immutable OAuth configuration consumed by later application and
 * infrastructure slices. Disabled configuration contains no provider secret
 * or registered client and is safe for core-auth startup.
 */
public record OAuthConfiguration(
        boolean enabled,
        Optional<OAuthClientRegistration> webClient,
        Optional<URI> issuerUri,
        Optional<OAuthSecret> clientSecret,
        Duration stateTtl,
        Duration handoffTtl,
        Duration csrfTtl,
        Duration providerTimeout,
        int maxHandoffProofFailures,
        CookiePolicy cookies,
        Set<String> allowedHostedDomains
) {

    /**
     * Google is the only provider enabled by the current OAuth milestone. Keeping
     * this trust anchor in the validated configuration prevents a generic issuer
     * value from redirecting discovery/JWK trust to an arbitrary HTTPS host.
     */
    public static final URI GOOGLE_ISSUER_URI = URI.create("https://accounts.google.com");

    public OAuthConfiguration {
        webClient = Objects.requireNonNull(webClient, "webClient must not be null");
        issuerUri = Objects.requireNonNull(issuerUri, "issuerUri must not be null");
        clientSecret = Objects.requireNonNull(clientSecret, "clientSecret must not be null");
        requirePositive(stateTtl, "stateTtl");
        requirePositive(handoffTtl, "handoffTtl");
        requirePositive(csrfTtl, "csrfTtl");
        requirePositive(providerTimeout, "providerTimeout");
        if (maxHandoffProofFailures < 1) {
            throw new IllegalArgumentException("maxHandoffProofFailures must be positive");
        }
        cookies = Objects.requireNonNull(cookies, "cookies must not be null");
        allowedHostedDomains = allowedHostedDomains == null
                ? Set.of()
                : Set.copyOf(allowedHostedDomains);
        if (enabled && (webClient.isEmpty() || issuerUri.isEmpty() || clientSecret.isEmpty())) {
            throw new IllegalArgumentException("enabled OAuth configuration is incomplete");
        }
        if (enabled && !GOOGLE_ISSUER_URI.equals(issuerUri.orElseThrow())) {
            throw new IllegalArgumentException("Google OAuth issuer must be https://accounts.google.com");
        }
        if (!enabled && (webClient.isPresent() || issuerUri.isPresent() || clientSecret.isPresent())) {
            throw new IllegalArgumentException("disabled OAuth configuration must not contain provider values");
        }
    }

    public static OAuthConfiguration disabled() {
        return new OAuthConfiguration(
                false,
                Optional.empty(),
                Optional.empty(),
                Optional.empty(),
                Duration.ofMinutes(10),
                Duration.ofSeconds(60),
                Duration.ofMinutes(10),
                Duration.ofSeconds(5),
                5,
                CookiePolicy.defaults(),
                Set.of()
        );
    }

    public static OAuthConfiguration enabled(
            OAuthClientRegistration webClient,
            URI issuerUri,
            OAuthSecret clientSecret,
            Duration stateTtl,
            Duration handoffTtl,
            Duration csrfTtl,
            Duration providerTimeout,
            int maxHandoffProofFailures,
            CookiePolicy cookies,
            Set<String> allowedHostedDomains
    ) {
        return new OAuthConfiguration(
                true,
                Optional.of(webClient),
                Optional.of(issuerUri),
                Optional.of(clientSecret),
                stateTtl,
                handoffTtl,
                csrfTtl,
                providerTimeout,
                maxHandoffProofFailures,
                cookies,
                allowedHostedDomains
        );
    }

    @Override
    public String toString() {
        return "OAuthConfiguration[enabled=" + enabled
                + ", webClient=" + webClient.map(OAuthClientRegistration::clientId).orElse("<disabled>")
                + ", issuerUri=" + issuerUri.map(URI::toString).orElse("<disabled>")
                + ", clientSecret=<redacted>"
                + ", stateTtl=" + stateTtl
                + ", handoffTtl=" + handoffTtl
                + ", csrfTtl=" + csrfTtl
                + ", providerTimeout=" + providerTimeout
                + ", maxHandoffProofFailures=" + maxHandoffProofFailures
                + ", cookies=" + cookies
                + ", allowedHostedDomains=" + allowedHostedDomains + "]";
    }

    public record CookiePolicy(
            boolean secure,
            String sameSite,
            String refreshCookiePath,
            String correlationCookiePath,
            String csrfCookiePath
    ) {
        public CookiePolicy {
            if (!secure) {
                throw new IllegalArgumentException("OAuth cookies must always use Secure");
            }
            if (sameSite == null || !sameSite.equals("Lax")) {
                throw new IllegalArgumentException("sameSite must be Lax");
            }
            if (!"/auth".equals(refreshCookiePath) || !"/auth".equals(correlationCookiePath)
                    || !"/".equals(csrfCookiePath)) {
                throw new IllegalArgumentException("OAuth cookie paths are fixed to /auth and /");
            }
        }

        public static CookiePolicy defaults() {
            return new CookiePolicy(true, "Lax", "/auth", "/auth", "/");
        }
    }

    private static void requirePositive(Duration value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        if (value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(name + " must be positive");
        }
    }
}
