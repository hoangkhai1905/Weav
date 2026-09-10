package com.weav.identity.infrastructure.config;

import com.weav.identity.application.dto.OAuthClientRegistration;
import com.weav.identity.application.dto.OAuthConfiguration;
import com.weav.identity.application.dto.OAuthSecret;
import com.weav.identity.application.validation.OAuthUriPolicy;
import com.weav.identity.domain.valueobject.OAuthProvider;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

/**
 * Spring-bound OAuth configuration. Empty Google configuration is a supported
 * disabled state; any partial configuration fails during bean creation rather
 * than silently enabling a broken provider flow.
 */
@ConfigurationProperties(prefix = "weav.oauth")
public class OAuthProperties {

    /**
     * Optional operator override. Blank means auto-enable when a provider
     * credential is present; false keeps OAuth disabled even if credentials
     * are mounted, while true requires a complete validated configuration.
     */
    private String enabled;
    private Duration stateTtl = Duration.ofMinutes(10);
    private Duration handoffTtl = Duration.ofSeconds(60);
    private Duration csrfTtl = Duration.ofMinutes(10);
    private Duration providerTimeout = Duration.ofSeconds(5);
    private int maxHandoffProofFailures = 5;
    private GoogleProperties google = new GoogleProperties();
    private WebProperties web = new WebProperties();

    public String getEnabled() {
        return enabled;
    }

    public void setEnabled(String enabled) {
        this.enabled = enabled;
    }

    public Duration getStateTtl() {
        return stateTtl;
    }

    public void setStateTtl(Duration stateTtl) {
        this.stateTtl = stateTtl;
    }

    public Duration getHandoffTtl() {
        return handoffTtl;
    }

    public void setHandoffTtl(Duration handoffTtl) {
        this.handoffTtl = handoffTtl;
    }

    public Duration getCsrfTtl() {
        return csrfTtl;
    }

    public void setCsrfTtl(Duration csrfTtl) {
        this.csrfTtl = csrfTtl;
    }

    public Duration getProviderTimeout() {
        return providerTimeout;
    }

    public void setProviderTimeout(Duration providerTimeout) {
        this.providerTimeout = providerTimeout;
    }

    public int getMaxHandoffProofFailures() {
        return maxHandoffProofFailures;
    }

    public void setMaxHandoffProofFailures(int maxHandoffProofFailures) {
        this.maxHandoffProofFailures = maxHandoffProofFailures;
    }

    public GoogleProperties getGoogle() {
        return google;
    }

    public void setGoogle(GoogleProperties google) {
        this.google = Objects.requireNonNull(google, "google must not be null");
    }

    public WebProperties getWeb() {
        return web;
    }

    public void setWeb(WebProperties web) {
        this.web = Objects.requireNonNull(web, "web must not be null");
    }

    public boolean isEnabled() {
        String configured = enabled == null ? "" : enabled.trim();
        if ("false".equalsIgnoreCase(configured)) {
            return false;
        }
        if (!configured.isEmpty() && !"true".equalsIgnoreCase(configured)) {
            throw new IllegalArgumentException("weav.oauth.enabled must be true, false, or blank");
        }
        return "true".equalsIgnoreCase(configured) || google.hasAnyCredentialValue();
    }

    public OAuthConfiguration validateAndBuild() {
        if (!isEnabled()) {
            return OAuthConfiguration.disabled();
        }

        requireDurationInRange(stateTtl, "stateTtl", Duration.ofSeconds(1), Duration.ofMinutes(15));
        requireDurationInRange(handoffTtl, "handoffTtl", Duration.ofSeconds(1), Duration.ofMinutes(5));
        requireDurationInRange(csrfTtl, "csrfTtl", Duration.ofSeconds(1), Duration.ofMinutes(15));
        requireDurationInRange(providerTimeout, "providerTimeout", Duration.ofMillis(100), Duration.ofSeconds(30));
        if (maxHandoffProofFailures < 1 || maxHandoffProofFailures > 10) {
            throw new IllegalArgumentException("maxHandoffProofFailures must be 1..10");
        }

        requireBoundedAscii(google.clientId, "google.clientId", 1, 256);
        requireBoundedAscii(google.clientSecret, "google.clientSecret", 1, 512);
        URI issuerUri = OAuthUriPolicy.requireIssuerUri(google.issuerUri, "google.issuerUri");
        if (!OAuthConfiguration.GOOGLE_ISSUER_URI.equals(issuerUri)) {
            throw new IllegalArgumentException("Google OAuth issuer must be https://accounts.google.com");
        }
        URI callbackUri = OAuthUriPolicy.requireRedirectUri(google.redirectUri, "google.redirectUri");
        URI returnTargetUri = OAuthUriPolicy.requireRedirectUri(web.returnTargetUri, "web.returnTargetUri");
        if (callbackUri.equals(returnTargetUri)) {
            throw new IllegalArgumentException("Google callback and web return target must be different URIs");
        }

        Set<String> allowedOrigins = canonicalOrigins(web.allowedOrigins);
        String returnOrigin = OAuthUriPolicy.originOf(returnTargetUri);
        if (!allowedOrigins.contains(returnOrigin)) {
            throw new IllegalArgumentException("web.returnTargetUri origin must be in web.allowedOrigins");
        }

        if (!web.cookieSecure) {
            throw new IllegalArgumentException("OAuth cookies must always use Secure");
        }

        OAuthConfiguration.CookiePolicy cookiePolicy = new OAuthConfiguration.CookiePolicy(
                web.cookieSecure,
                web.cookieSameSite,
                web.refreshCookiePath,
                web.correlationCookiePath,
                web.csrfCookiePath
        );

        Set<String> hostedDomains = canonicalHostedDomains(google.allowedHostedDomains);
        OAuthClientRegistration registration = new OAuthClientRegistration(
                "web",
                "web",
                OAuthProvider.GOOGLE,
                google.clientId,
                callbackUri,
                returnTargetUri,
                allowedOrigins
        );
        return OAuthConfiguration.enabled(
                registration,
                issuerUri,
                new OAuthSecret(google.clientSecret),
                stateTtl,
                handoffTtl,
                csrfTtl,
                providerTimeout,
                maxHandoffProofFailures,
                cookiePolicy,
                hostedDomains
        );
    }

    @Override
    public String toString() {
        return "OAuthProperties[enabled=" + (enabled == null ? "<blank>" : enabled)
                + ", stateTtl=" + stateTtl
                + ", handoffTtl=" + handoffTtl
                + ", csrfTtl=" + csrfTtl
                + ", providerTimeout=" + providerTimeout
                + ", maxHandoffProofFailures=" + maxHandoffProofFailures
                + ", google=<redacted>, web=" + web + "]";
    }

    public static final class GoogleProperties {

        private String clientId;
        private String clientSecret;
        private String issuerUri;
        private String redirectUri;
        private List<String> allowedHostedDomains = new ArrayList<>();

        public String getClientId() {
            return clientId;
        }

        public void setClientId(String clientId) {
            this.clientId = clientId;
        }

        public String getClientSecret() {
            return clientSecret;
        }

        public void setClientSecret(String clientSecret) {
            this.clientSecret = clientSecret;
        }

        public String getIssuerUri() {
            return issuerUri;
        }

        public void setIssuerUri(String issuerUri) {
            this.issuerUri = issuerUri;
        }

        public String getRedirectUri() {
            return redirectUri;
        }

        public void setRedirectUri(String redirectUri) {
            this.redirectUri = redirectUri;
        }

        public List<String> getAllowedHostedDomains() {
            return allowedHostedDomains;
        }

        public void setAllowedHostedDomains(List<String> allowedHostedDomains) {
            this.allowedHostedDomains = allowedHostedDomains == null
                    ? new ArrayList<>()
                    : new ArrayList<>(allowedHostedDomains);
        }

        private boolean hasAnyCredentialValue() {
            return hasText(clientId) || hasText(clientSecret);
        }

        @Override
        public String toString() {
            return "GoogleProperties[clientId=<redacted>, clientSecret=<redacted>, issuerUri=<redacted>, redirectUri=<redacted>, allowedHostedDomains=<redacted>]";
        }
    }

    public static final class WebProperties {

        private String returnTargetUri;
        private List<String> allowedOrigins = new ArrayList<>();
        private boolean cookieSecure = true;
        private String cookieSameSite = "Lax";
        private String refreshCookiePath = "/auth";
        private String correlationCookiePath = "/auth";
        private String csrfCookiePath = "/";

        public String getReturnTargetUri() {
            return returnTargetUri;
        }

        public void setReturnTargetUri(String returnTargetUri) {
            this.returnTargetUri = returnTargetUri;
        }

        public List<String> getAllowedOrigins() {
            return allowedOrigins;
        }

        public void setAllowedOrigins(List<String> allowedOrigins) {
            this.allowedOrigins = allowedOrigins == null
                    ? new ArrayList<>()
                    : new ArrayList<>(allowedOrigins);
        }

        public boolean isCookieSecure() {
            return cookieSecure;
        }

        public void setCookieSecure(boolean cookieSecure) {
            this.cookieSecure = cookieSecure;
        }

        public String getCookieSameSite() {
            return cookieSameSite;
        }

        public void setCookieSameSite(String cookieSameSite) {
            this.cookieSameSite = cookieSameSite;
        }

        public String getRefreshCookiePath() {
            return refreshCookiePath;
        }

        public void setRefreshCookiePath(String refreshCookiePath) {
            this.refreshCookiePath = refreshCookiePath;
        }

        public String getCorrelationCookiePath() {
            return correlationCookiePath;
        }

        public void setCorrelationCookiePath(String correlationCookiePath) {
            this.correlationCookiePath = correlationCookiePath;
        }

        public String getCsrfCookiePath() {
            return csrfCookiePath;
        }

        public void setCsrfCookiePath(String csrfCookiePath) {
            this.csrfCookiePath = csrfCookiePath;
        }

        private boolean hasAnyConfiguredValue() {
            return hasText(returnTargetUri) || (allowedOrigins != null && !allowedOrigins.isEmpty())
                    || !cookieSecure;
        }

        @Override
        public String toString() {
            return "WebProperties[returnTargetUri=<redacted>, allowedOrigins=<redacted>, cookieSecure="
                    + cookieSecure + ", cookieSameSite=" + cookieSameSite
                    + ", refreshCookiePath=" + refreshCookiePath
                    + ", correlationCookiePath=" + correlationCookiePath
                    + ", csrfCookiePath=" + csrfCookiePath + "]";
        }
    }

    private static Set<String> canonicalOrigins(List<String> configuredOrigins) {
        if (configuredOrigins == null || configuredOrigins.isEmpty() || configuredOrigins.size() > 16) {
            throw new IllegalArgumentException("web.allowedOrigins must contain 1..16 concrete origins");
        }
        Set<String> result = new LinkedHashSet<>();
        for (String configuredOrigin : configuredOrigins) {
            String canonical = OAuthUriPolicy.requireOrigin(configuredOrigin, "web.allowedOrigins");
            if (!result.add(canonical)) {
                throw new IllegalArgumentException("web.allowedOrigins must not contain duplicates");
            }
        }
        return Set.copyOf(result);
    }

    private static Set<String> canonicalHostedDomains(List<String> configuredDomains) {
        if (configuredDomains == null || configuredDomains.isEmpty()) {
            return Set.of();
        }
        if (configuredDomains.size() > 16) {
            throw new IllegalArgumentException("google.allowedHostedDomains must contain at most 16 domains");
        }
        Set<String> result = new LinkedHashSet<>();
        for (String configuredDomain : configuredDomains) {
            if (configuredDomain == null || configuredDomain.isBlank() || configuredDomain.length() > 253
                    || configuredDomain.indexOf('*') >= 0 || configuredDomain.indexOf('/') >= 0
                    || configuredDomain.indexOf('@') >= 0
                    || !configuredDomain.chars().allMatch(character -> character < 0x80
                    && (Character.isLetterOrDigit(character) || character == '.' || character == '-'))) {
                throw new IllegalArgumentException("google.allowedHostedDomains contains an invalid domain");
            }
            String canonical = configuredDomain.toLowerCase(Locale.ROOT);
            if (!result.add(canonical)) {
                throw new IllegalArgumentException("google.allowedHostedDomains must not contain duplicates");
            }
        }
        return Set.copyOf(result);
    }

    private static void requireDurationInRange(Duration value, String name, Duration minimum, Duration maximum) {
        if (value == null || value.compareTo(minimum) < 0 || value.compareTo(maximum) > 0) {
            throw new IllegalArgumentException(name + " must be between " + minimum + " and " + maximum);
        }
    }

    private static void requireBoundedAscii(String value, String name, int minimum, int maximum) {
        if (value == null || value.length() < minimum || value.length() > maximum
                || value.chars().anyMatch(character -> character < 0x20 || character > 0x7e)) {
            throw new IllegalArgumentException(name + " must be printable ASCII of length " + minimum + ".." + maximum);
        }
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
