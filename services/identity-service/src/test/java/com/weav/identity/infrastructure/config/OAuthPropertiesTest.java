package com.weav.identity.infrastructure.config;

import com.weav.identity.application.dto.OAuthConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.time.Duration;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OAuthPropertiesTest {

    @Test
    void absentGoogleConfigurationCreatesDisabledSafeConfiguration() {
        OAuthProperties properties = new OAuthProperties();

        OAuthConfiguration configuration = properties.validateAndBuild();

        assertFalse(properties.isEnabled());
        assertFalse(configuration.enabled());
        assertTrue(configuration.webClient().isEmpty());
        assertTrue(properties.toString().contains("google=<redacted>"));
    }

    @Test
    void springBindingBuildsAnEnabledRegisteredWebClient() {
        new ApplicationContextRunner()
                .withUserConfiguration(OAuthApplicationConfig.class)
                .withPropertyValues(
                        "weav.oauth.enabled=true",
                        "weav.oauth.google.client-id=google-client-id.apps.googleusercontent.com",
                        "weav.oauth.google.client-secret=provider-secret-value",
                        "weav.oauth.google.issuer-uri=https://accounts.google.com",
                        "weav.oauth.google.redirect-uri=http://localhost:8081/auth/oauth/google/callback",
                        "weav.oauth.web.return-target-uri=http://localhost:5173/auth/callback",
                        "weav.oauth.web.allowed-origins[0]=http://localhost:5173"
                )
                .run(context -> {
                    assertFalse(context.getStartupFailure() != null);
                    OAuthConfiguration configuration = context.getBean(OAuthConfiguration.class);
                    assertTrue(configuration.enabled());
                    assertTrue(configuration.webClient().orElseThrow().allowsOrigin("http://localhost:5173"));
                    assertTrue(configuration.webClient().orElseThrow().clientId().equals("web"));
                });
    }

    @Test
    void emptyTemplateCredentialsKeepApplicationPropertiesDisabled() {
        new ApplicationContextRunner()
                .withUserConfiguration(OAuthApplicationConfig.class)
                .withPropertyValues(
                        "weav.oauth.enabled=",
                        "weav.oauth.google.client-id=",
                        "weav.oauth.google.client-secret="
                )
                .run(context -> {
                    assertFalse(context.getStartupFailure() != null);
                    assertFalse(context.getBean(OAuthConfiguration.class).enabled());
                });
    }

    @Test
    void explicitEnableWithMissingCredentialFailsClosedAtStartup() {
        new ApplicationContextRunner()
                .withUserConfiguration(OAuthApplicationConfig.class)
                .withPropertyValues(
                        "weav.oauth.enabled=true",
                        "weav.oauth.google.client-id=google-client-id.apps.googleusercontent.com",
                        "weav.oauth.google.client-secret=",
                        "weav.oauth.google.redirect-uri=http://localhost:8081/auth/oauth/google/callback"
                )
                .run(context -> assertNotNull(context.getStartupFailure()));
    }

    @Test
    void partialGoogleConfigurationFailsClosedAtContextStartup() {
        new ApplicationContextRunner()
                .withUserConfiguration(OAuthApplicationConfig.class)
                .withPropertyValues(
                        "weav.oauth.enabled=true",
                        "weav.oauth.google.client-id=partial-client")
                .run(context -> assertNotNull(context.getStartupFailure()));
    }

    @Test
    void rejectsWildcardUserInfoFragmentAndUnsafeSchemes() {
        OAuthProperties wildcard = validProperties();
        wildcard.getGoogle().setRedirectUri("https://*.example.com/auth/callback");
        assertThrows(IllegalArgumentException.class, wildcard::validateAndBuild);

        OAuthProperties userInfo = validProperties();
        userInfo.getGoogle().setRedirectUri("https://user:password@example.com/auth/callback");
        assertThrows(IllegalArgumentException.class, userInfo::validateAndBuild);

        OAuthProperties fragment = validProperties();
        fragment.getWeb().setReturnTargetUri("https://app.example.com/auth/callback#fragment");
        assertThrows(IllegalArgumentException.class, fragment::validateAndBuild);

        OAuthProperties unsafeScheme = validProperties();
        unsafeScheme.getWeb().setReturnTargetUri("javascript:alert(1)");
        assertThrows(IllegalArgumentException.class, unsafeScheme::validateAndBuild);
    }

    @Test
    void rejectsNonLoopbackHttpAndInconsistentRegisteredTarget() {
        OAuthProperties insecureProduction = validProperties();
        insecureProduction.getGoogle().setRedirectUri("http://identity.example.com/auth/callback");
        assertThrows(IllegalArgumentException.class, insecureProduction::validateAndBuild);

        OAuthProperties wrongOrigin = validProperties();
        wrongOrigin.getWeb().setAllowedOrigins(List.of("https://different.example.com"));
        assertThrows(IllegalArgumentException.class, wrongOrigin::validateAndBuild);
    }

    @Test
    void rejectsNonGoogleIssuerAtConfigurationBinding() {
        OAuthProperties properties = validProperties();
        properties.getGoogle().setIssuerUri("https://issuer.example.com");

        assertThrows(IllegalArgumentException.class, properties::validateAndBuild);
    }

    @Test
    void rejectsInsecureCookieModeForLoopbackAndProductionConfiguration() {
        OAuthProperties loopback = validProperties();
        loopback.getGoogle().setRedirectUri("http://localhost:8081/auth/oauth/google/callback");
        loopback.getWeb().setReturnTargetUri("http://localhost:5173/auth/callback");
        loopback.getWeb().setAllowedOrigins(List.of("http://localhost:5173"));
        loopback.getWeb().setCookieSecure(false);

        assertThrows(IllegalArgumentException.class, loopback::validateAndBuild);

        OAuthProperties production = validProperties();
        production.getWeb().setCookieSecure(false);
        assertThrows(IllegalArgumentException.class, production::validateAndBuild);

        assertTrue(validProperties().validateAndBuild().cookies().secure());
        assertThrows(IllegalArgumentException.class, () -> new OAuthConfiguration.CookiePolicy(
                false, "Lax", "/auth", "/auth", "/"
        ));
    }

    @Test
    void canonicalizesDefaultReturnOriginPortAndKeepsBrowserOriginExact() {
        OAuthProperties properties = validProperties();
        properties.getWeb().setReturnTargetUri("https://app.example.com:443/auth/callback");
        properties.getWeb().setAllowedOrigins(List.of("https://app.example.com"));

        OAuthConfiguration configuration = properties.validateAndBuild();

        assertTrue(configuration.webClient().orElseThrow().allowsOrigin("https://app.example.com"));
        assertFalse(configuration.webClient().orElseThrow().allowsOrigin("https://app.example.com:443"));
    }

    @Test
    void acceptsLoopbackHttpDefaultPortAndRejectsNonDefaultPortMismatch() {
        OAuthProperties loopback = validProperties();
        loopback.getGoogle().setRedirectUri("http://[::1]:80/auth/oauth/google/callback");
        loopback.getWeb().setReturnTargetUri("http://localhost:80/auth/callback");
        loopback.getWeb().setAllowedOrigins(List.of("http://localhost"));

        assertTrue(loopback.validateAndBuild().webClient().orElseThrow()
                .allowsOrigin("http://localhost"));

        OAuthProperties mismatchedPort = validProperties();
        mismatchedPort.getWeb().setReturnTargetUri("https://app.example.com:8443/auth/callback");
        mismatchedPort.getWeb().setAllowedOrigins(List.of("https://app.example.com"));

        assertThrows(IllegalArgumentException.class, mismatchedPort::validateAndBuild);
    }

    @Test
    void rejectsChangedCookiePathsAndUnboundedDurations() {
        OAuthProperties wrongPath = validProperties();
        wrongPath.getWeb().setCsrfCookiePath("/auth");
        assertThrows(IllegalArgumentException.class, wrongPath::validateAndBuild);

        OAuthProperties wrongDuration = validProperties();
        wrongDuration.setStateTtl(Duration.ofMinutes(16));
        assertThrows(IllegalArgumentException.class, wrongDuration::validateAndBuild);
    }

    @Test
    void redactsProviderSecretFromPropertiesAndValidatedConfiguration() {
        OAuthProperties properties = validProperties();
        String secret = properties.getGoogle().getClientSecret();

        assertFalse(properties.toString().contains(secret));
        assertFalse(properties.validateAndBuild().toString().contains(secret));
    }

    @Test
    void explicitDisabledModeIgnoresMountedProviderCredentials() {
        OAuthProperties properties = validProperties();
        properties.setEnabled("false");

        assertFalse(properties.isEnabled());
        assertFalse(properties.validateAndBuild().enabled());
    }

    @Test
    void autoModeEnablesWhenProviderCredentialsArePresent() {
        OAuthProperties properties = validProperties();
        properties.setEnabled("");

        assertTrue(properties.isEnabled());
        assertTrue(properties.validateAndBuild().enabled());
    }

    @Test
    void invalidExplicitModeFailsClosed() {
        OAuthProperties properties = validProperties();
        properties.setEnabled("sometimes");

        assertThrows(IllegalArgumentException.class, properties::validateAndBuild);
    }

    @Test
    void rejectsNonAsciiProviderClientCredentials() {
        OAuthProperties properties = validProperties();
        properties.getGoogle().setClientSecret("provider-secret-é");

        assertThrows(IllegalArgumentException.class, properties::validateAndBuild);
    }

    private static OAuthProperties validProperties() {
        OAuthProperties properties = new OAuthProperties();
        properties.setEnabled("true");
        properties.getGoogle().setClientId("google-client-id.apps.googleusercontent.com");
        properties.getGoogle().setClientSecret("provider-secret-value");
        properties.getGoogle().setIssuerUri("https://accounts.google.com");
        properties.getGoogle().setRedirectUri("https://identity.example.com/auth/oauth/google/callback");
        properties.getWeb().setReturnTargetUri("https://app.example.com/auth/callback");
        properties.getWeb().setAllowedOrigins(List.of("https://app.example.com"));
        return properties;
    }
}
