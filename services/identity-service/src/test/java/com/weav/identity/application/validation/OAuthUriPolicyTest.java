package com.weav.identity.application.validation;

import org.junit.jupiter.api.Test;

import java.net.URI;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OAuthUriPolicyTest {

    @Test
    void acceptsBracketedIpv6LoopbackHttpRedirect() {
        URI redirect = OAuthUriPolicy.requireRedirectUri(
                "http://[::1]:5173/auth/oauth/google/callback", "redirectUri");

        assertTrue(OAuthUriPolicy.isLoopback(redirect));
        assertEquals("http://[::1]:5173", OAuthUriPolicy.originOf(redirect));
    }

    @Test
    void rejectsNonLoopbackIpv6HttpRedirect() {
        assertThrows(IllegalArgumentException.class, () -> OAuthUriPolicy.requireRedirectUri(
                "http://[2001:db8::1]:5173/auth/oauth/google/callback", "redirectUri"));
    }

    @Test
    void omitsOnlyDefaultPortsFromCanonicalOrigins() {
        assertEquals("https://app.example.com", OAuthUriPolicy.originOf(
                URI.create("https://app.example.com:443/auth/callback")));
        assertEquals("http://localhost", OAuthUriPolicy.originOf(
                URI.create("http://localhost:80/auth/callback")));
        assertEquals("https://app.example.com:8443", OAuthUriPolicy.originOf(
                URI.create("https://app.example.com:8443/auth/callback")));
    }

    @Test
    void mobileReturnTargetAcceptsOnlyTheWeavScheme() {
        URI target = OAuthUriPolicy.requireMobileReturnTarget("weav://auth/callback", "mobileReturn");

        assertEquals("weav", target.getScheme());
        assertEquals("/callback", target.getPath());
        assertEquals("weav://auth/callback",
                OAuthUriPolicy.requireMobileReturnTarget("WEAV://auth/callback", "mobileReturn").toString());
        for (String rejected : new String[] {
                "https://app.example.com/auth/callback",
                "http://localhost:5173/auth/callback",
                "mobile://auth/callback",
                "javascript:alert(1)",
                "data:text/html,x",
                "weav://user:pw@auth/callback",
                "weav://auth/callback?x=1",
                "weav://auth/callback#frag",
                "weav://*/callback",
                "weav://auth",
                "weav:auth/callback",
                "/callback",
                " "}) {
            assertThrows(IllegalArgumentException.class,
                    () -> OAuthUriPolicy.requireMobileReturnTarget(rejected, "mobileReturn"), rejected);
        }
    }

    @Test
    void webRedirectRulesStillRejectTheCustomScheme() {
        assertThrows(IllegalArgumentException.class,
                () -> OAuthUriPolicy.requireRedirectUri("weav://auth/callback", "redirectUri"));
    }
}
