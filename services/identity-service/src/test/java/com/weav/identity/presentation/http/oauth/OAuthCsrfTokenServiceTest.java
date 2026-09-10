package com.weav.identity.presentation.http.oauth;

import com.weav.identity.application.dto.OAuthClientRegistration;
import com.weav.identity.application.dto.OAuthConfiguration;
import com.weav.identity.application.dto.OAuthSecret;
import com.weav.identity.domain.exception.ForbiddenException;
import com.weav.identity.domain.valueobject.OAuthProvider;
import com.weav.identity.infrastructure.authstate.HmacKeyedFingerprint;
import com.weav.identity.infrastructure.security.JwtProperties;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.net.URI;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OAuthCsrfTokenServiceTest {

    private static final Instant NOW = Instant.parse("2026-09-10T10:00:00Z");
    private static final String HMAC_SECRET = "csrf-test-hmac-secret-012345678901234567890";
    private static final HmacKeyedFingerprint FINGERPRINT = new HmacKeyedFingerprint(HMAC_SECRET);
    private static final OAuthConfiguration CONFIGURATION = OAuthConfiguration.disabled();

    @Test
    void acceptsAValidOpaqueToken() {
        OAuthCsrfTokenService service = serviceAt(NOW);

        String token = service.issue();

        assertTrue(token.length() == 43);
        assertTrue(service.isValid(token));
    }

    @Test
    void rejectsTamperedSignature() {
        OAuthCsrfTokenService service = serviceAt(NOW);
        String token = service.issue();
        byte[] decoded = Base64.getUrlDecoder().decode(token);
        decoded[decoded.length - 1] ^= 0x01;
        String tampered = Base64.getUrlEncoder().withoutPadding().encodeToString(decoded);

        assertEquals(43, tampered.length());
        assertFalse(service.isValid(tampered));
    }

    @Test
    void rejectsExpiredToken() {
        String token = serviceAt(NOW).issue();

        assertFalse(serviceAt(NOW.plus(Duration.ofMinutes(10))).isValid(token));
    }

    @Test
    void rejectsFutureToken() {
        String token = serviceAt(NOW.plusSeconds(1)).issue();

        assertFalse(serviceAt(NOW).isValid(token));
    }

    @Test
    void rejectsOversizedTokenBeforeDecoding() {
        String token = serviceAt(NOW).issue();

        assertFalse(serviceAt(NOW).isValid(token + "A"));
    }

    @Test
    void rejectsDuplicateDoubleSubmitCookies() {
        OAuthCsrfTokenService service = serviceAt(NOW);
        String token = service.issue();
        OAuthWebProtection protection = new OAuthWebProtection(
                enabledConfiguration(),
                jwtProperties(),
                service);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Origin", "https://web.test");
        request.addHeader(OAuthWebProtection.CSRF_HEADER, token);
        request.setCookies(new Cookie(OAuthWebProtection.CSRF_COOKIE, token),
                new Cookie(OAuthWebProtection.CSRF_COOKIE, token));

        assertThrows(ForbiddenException.class, () -> protection.requireOriginAndCsrf(request));
    }

    @Test
    void acceptsOneValidDoubleSubmitCookie() {
        OAuthCsrfTokenService service = serviceAt(NOW);
        String token = service.issue();
        OAuthWebProtection protection = new OAuthWebProtection(
                enabledConfiguration(),
                jwtProperties(),
                service);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Origin", "https://web.test");
        request.addHeader(OAuthWebProtection.CSRF_HEADER, token);
        request.setCookies(new Cookie(OAuthWebProtection.CSRF_COOKIE, token));

        assertDoesNotThrow(() -> protection.requireOriginAndCsrf(request));
    }

    private static OAuthCsrfTokenService serviceAt(Instant instant) {
        return new OAuthCsrfTokenService(
                CONFIGURATION,
                FINGERPRINT,
                new SecureRandom(),
                Clock.fixed(instant, ZoneOffset.UTC));
    }

    private static OAuthConfiguration enabledConfiguration() {
        return OAuthConfiguration.enabled(
                new OAuthClientRegistration(
                        "web",
                        "web",
                        OAuthProvider.GOOGLE,
                        "google-client",
                        URI.create("http://127.0.0.1/auth/oauth/google/callback"),
                        URI.create("https://web.test/auth/callback"),
                        Set.of("https://web.test")),
                OAuthConfiguration.GOOGLE_ISSUER_URI,
                new OAuthSecret("provider-secret"),
                Duration.ofMinutes(10),
                Duration.ofSeconds(60),
                Duration.ofMinutes(10),
                Duration.ofSeconds(5),
                5,
                OAuthConfiguration.CookiePolicy.defaults(),
                Set.of());
    }

    private static JwtProperties jwtProperties() {
        return new JwtProperties(
                "access-secret-012345678901234567890123456789",
                "refresh-secret-012345678901234567890123456789",
                "weav",
                "weav-api",
                Duration.ofMinutes(15),
                Duration.ofDays(7),
                Duration.ofSeconds(30));
    }
}
