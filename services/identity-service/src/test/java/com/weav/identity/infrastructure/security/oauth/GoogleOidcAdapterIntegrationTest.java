package com.weav.identity.infrastructure.security.oauth;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.weav.identity.application.dto.OAuthClientRegistration;
import com.weav.identity.application.dto.OAuthConfiguration;
import com.weav.identity.application.dto.OAuthSecret;
import com.weav.identity.application.port.out.OAuthProviderClient;
import com.weav.identity.application.validation.OAuthProtocolPolicy;
import com.weav.identity.domain.exception.DependencyUnavailableException;
import com.weav.identity.domain.valueobject.OAuthProvider;
import com.weav.identity.infrastructure.authstate.HmacKeyedFingerprint;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GoogleOidcAdapterIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-09-09T12:00:00Z");
    private static final String ISSUER = "https://accounts.google.com";
    private static final String CLIENT_ID = "test-google-client";
    private static final String CLIENT_SECRET = "test-google-client-secret";
    private static final String HMAC_SECRET = "01234567890123456789012345678901";
    private static final String MAC_SECRET = "0123456789012345678901234567890123456789012345678901234567890123";

    private final ObjectMapper objectMapper = JsonMapper.builder().findAndAddModules().build();
    private final HmacKeyedFingerprint fingerprint = new HmacKeyedFingerprint(HMAC_SECRET);
    private HttpServer server;
    private RSAKey signingKey;
    private RSAKey alternateKey;
    private RSAKey sameKidAlternateKey;
    private AtomicReference<JWTClaimsSet> tokenClaims;
    private AtomicReference<RSAKey> tokenKey;
    private AtomicInteger discoveryHits;
    private AtomicInteger tokenHits;
    private AtomicInteger jwksHits;
    private JWSAlgorithm tokenAlgorithm;
    private boolean macToken;
    private int discoveryStatus;
    private int tokenStatus;
    private int jwksStatus;
    private Duration tokenDelay;
    private String lastTokenBody;
    private String lastAuthorizationHeader;
    private URI discoveryUri;
    private OAuthClientRegistration registration;

    @BeforeEach
    void startProviderStub() throws Exception {
        signingKey = new RSAKeyGenerator(2048).keyID("provider-kid").generate();
        alternateKey = new RSAKeyGenerator(2048).keyID("other-kid").generate();
        sameKidAlternateKey = new RSAKeyGenerator(2048).keyID("provider-kid").generate();
        discoveryStatus = 200;
        tokenStatus = 200;
        jwksStatus = 200;
        tokenDelay = Duration.ZERO;
        lastTokenBody = null;
        lastAuthorizationHeader = null;
        tokenKey = new AtomicReference<>(signingKey);
        discoveryHits = new AtomicInteger();
        tokenHits = new AtomicInteger();
        jwksHits = new AtomicInteger();
        tokenAlgorithm = JWSAlgorithm.RS256;
        macToken = false;

        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        int port = server.getAddress().getPort();
        discoveryUri = URI.create("http://127.0.0.1:" + port + "/.well-known/openid-configuration");
        registration = new OAuthClientRegistration(
                "web", "web", OAuthProvider.GOOGLE, CLIENT_ID,
                URI.create("http://127.0.0.1:" + port + "/auth/callback"),
                URI.create("http://127.0.0.1:" + port + "/return"),
                Set.of("http://127.0.0.1:" + port));
        tokenClaims = new AtomicReference<>(validClaims(token("nonce"), "provider-subject", CLIENT_ID));
        server.createContext("/.well-known/openid-configuration", this::handleDiscovery);
        server.createContext("/token", this::handleToken);
        server.createContext("/jwks", this::handleJwks);
        server.start();
    }

    @AfterEach
    void stopProviderStub() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void authorizationUrlUsesExactRegisteredRedirectScopesAndServerPkce() {
        String state = token("state");
        String nonce = token("nonce");
        String verifier = "A".repeat(43);
        GoogleOidcAdapter adapter = adapter(Duration.ofSeconds(2));

        URI authorizationUrl = adapter.buildAuthorizationUrl(new OAuthProviderClient.AuthorizationRequest(
                registration, new OAuthSecret(state), new OAuthSecret(nonce), new OAuthSecret(verifier))).value();
        Map<String, String> query = query(authorizationUrl);

        assertEquals("http://127.0.0.1:" + server.getAddress().getPort() + "/authorize", originAndPath(authorizationUrl));
        assertEquals(CLIENT_ID, query.get("client_id"));
        assertEquals(registration.providerCallbackUri().toString(), query.get("redirect_uri"));
        assertEquals(state, query.get("state"));
        assertEquals(nonce, query.get("nonce"));
        assertEquals(OAuthProtocolPolicy.challengeForVerifier(verifier), query.get("code_challenge"));
        assertEquals("S256", query.get("code_challenge_method"));
        assertEquals(Set.of("openid", "email", "profile"), Set.of(query.get("scope").split(" ")));
        assertFalse(query.containsKey("access_type"));
        assertFalse(query.containsKey("code_verifier"));
        assertFalse(authorizationUrl.toString().contains(CLIENT_SECRET));
        assertFalse(authorizationUrl.toString().contains(verifier));
    }

    @Test
    void callerCannotSubstituteARegistrationOrProviderEndpoint() {
        OAuthClientRegistration attacker = new OAuthClientRegistration(
                "web", "web", OAuthProvider.GOOGLE, "attacker-client",
                URI.create("http://127.0.0.1:9/attacker"),
                registration.returnTargetUri(), registration.allowedOrigins());
        GoogleOidcAdapter adapter = adapter(Duration.ofSeconds(2));

        assertThrows(IllegalArgumentException.class, () -> adapter.buildAuthorizationUrl(
                new OAuthProviderClient.AuthorizationRequest(
                        attacker, new OAuthSecret(token("state")), new OAuthSecret(token("nonce")),
                        new OAuthSecret("A".repeat(43)))));
    }

    @Test
    void exchangesSignedIdTokenWithFixedRegistrationAndServerVerifier() {
        String nonce = token("nonce-good");
        String verifier = "B".repeat(43);
        tokenClaims.set(validClaims(nonce, "Google-Case-Sensitive-Subject", CLIENT_ID));
        GoogleOidcAdapter adapter = adapter(Duration.ofSeconds(2));

        OAuthProviderClient.ProviderIdentity identity = adapter.exchangeAuthorizationCode(
                new OAuthProviderClient.AuthorizationCodeRequest(
                        registration,
                        new OAuthSecret("provider-code"),
                        new OAuthSecret(verifier),
                        fingerprint.fingerprint("oauth-google-nonce", nonce)));

        assertEquals(OAuthProvider.GOOGLE, identity.provider());
        assertEquals("Google-Case-Sensitive-Subject", identity.providerSubject());
        assertEquals("person@gmail.com", identity.providerEmail());
        assertTrue(identity.emailVerified());
        assertEquals("example.com", identity.hostedDomain());
        assertEquals(NOW.minusSeconds(5), identity.issuedAt());
        assertTrue(lastTokenBody.contains("code_verifier=" + verifier));
        assertTrue(lastTokenBody.contains("redirect_uri="
                + urlEncoded(registration.providerCallbackUri().toString())));
        assertNotNull(lastAuthorizationHeader);
        assertTrue(lastAuthorizationHeader.startsWith("Basic "));
    }

    @Test
    void subjectOnlyIdentityIsAcceptedWhenGoogleOmitsEmail() {
        String nonce = token("nonce-subject-only");
        tokenClaims.set(validClaims(nonce, "subject-only", CLIENT_ID, null, null, true));

        OAuthProviderClient.ProviderIdentity identity = exchange(adapter(Duration.ofSeconds(2)), nonce);

        assertEquals("subject-only", identity.providerSubject());
        assertEquals(null, identity.providerEmail());
        assertTrue(identity.emailVerified());
    }

    @Test
    void rejectsKnownKidBadSignatureUnknownKidAndUnsupportedAlgorithm() {
        String nonce = token("nonce-signature");
        tokenClaims.set(validClaims(nonce, "wrong-signature", CLIENT_ID));
        tokenKey.set(sameKidAlternateKey);
        assertSanitizedFailure(nonce);

        tokenKey.set(alternateKey);
        assertSanitizedFailure(nonce);

        tokenKey.set(signingKey);
        tokenAlgorithm = JWSAlgorithm.HS256;
        macToken = true;
        assertSanitizedFailure(nonce);
    }

    @Test
    void rejectsIssuerAudienceAndMultipleAudienceAzpFailures() {
        String nonce = token("nonce-audience");
        tokenClaims.set(copy(validClaims(nonce, "bad-issuer", CLIENT_ID))
                .issuer("https://evil.example")
                .build());
        assertSanitizedFailure(nonce);

        tokenClaims.set(validClaims(nonce, "bad-audience", "wrong-client"));
        assertSanitizedFailure(nonce);

        tokenClaims.set(validClaims(nonce, "single-audience-wrong-azp", List.of(CLIENT_ID), "wrong-azp"));
        assertSanitizedFailure(nonce);

        tokenClaims.set(validClaims(nonce, "missing-azp", List.of(CLIENT_ID, "another-client"), null));
        assertSanitizedFailure(nonce);

        tokenClaims.set(validClaims(nonce, "wrong-azp", List.of(CLIENT_ID, "another-client"), "wrong-azp"));
        assertSanitizedFailure(nonce);
    }

    @Test
    void acceptsMultipleAudiencesWithMatchingAzp() {
        String nonce = token("nonce-multiple-audiences");
        tokenClaims.set(validClaims(nonce, "multiple-audiences", List.of(CLIENT_ID, "another-client"), CLIENT_ID));

        OAuthProviderClient.ProviderIdentity identity = exchange(adapter(Duration.ofSeconds(2)), nonce);

        assertEquals("multiple-audiences", identity.providerSubject());
    }

    @Test
    void acceptsGoogleLegacyIssuerSpelling() {
        String nonce = token("nonce-legacy-issuer");
        tokenClaims.set(copy(validClaims(nonce, "legacy-issuer", CLIENT_ID))
                .issuer("accounts.google.com")
                .build());

        OAuthProviderClient.ProviderIdentity identity = exchange(adapter(Duration.ofSeconds(2)), nonce);

        assertEquals("legacy-issuer", identity.providerSubject());
    }

    @Test
    void rejectsNonceExpiredFutureIssuedAtMissingRequiredClaimsAndFutureNotBefore() {
        String nonce = token("nonce-time");
        tokenClaims.set(validClaims(token("other-nonce"), "wrong-nonce", CLIENT_ID));
        assertSanitizedFailure(nonce);

        tokenClaims.set(copy(validClaims(nonce, "expired", CLIENT_ID))
                .expirationTime(Date.from(NOW.minusSeconds(61)))
                .build());
        assertSanitizedFailure(nonce);

        tokenClaims.set(copy(validClaims(nonce, "future-issued", CLIENT_ID))
                .issueTime(Date.from(NOW.plusSeconds(61)))
                .expirationTime(Date.from(NOW.plusSeconds(300)))
                .build());
        assertSanitizedFailure(nonce);

        tokenClaims.set(copy(validClaims(nonce, "missing-exp", CLIENT_ID))
                .expirationTime(null)
                .build());
        assertSanitizedFailure(nonce);

        tokenClaims.set(copy(validClaims(nonce, "missing-iat", CLIENT_ID))
                .issueTime(null)
                .build());
        assertSanitizedFailure(nonce);

        tokenClaims.set(copy(validClaims(nonce, "missing-nonce", CLIENT_ID))
                .claim("nonce", null)
                .build());
        assertSanitizedFailure(nonce);

        tokenClaims.set(copy(validClaims(nonce, "future-not-before", CLIENT_ID))
                .notBeforeTime(Date.from(NOW.plusSeconds(61)))
                .build());
        assertSanitizedFailure(nonce);
    }

    @Test
    void rejectsMalformedTypedProviderClaims() {
        String nonce = token("nonce-claims");
        tokenClaims.set(copy(validClaims(nonce, "typed-email", CLIENT_ID))
                .claim("email", 42)
                .build());
        assertSanitizedFailure(nonce);

        tokenClaims.set(copy(validClaims(nonce, "typed-verified", CLIENT_ID))
                .claim("email_verified", "true")
                .build());
        assertSanitizedFailure(nonce);

        tokenClaims.set(copy(validClaims(nonce, "typed-hosted-domain", CLIENT_ID))
                .claim("hd", List.of("example.com"))
                .build());
        assertSanitizedFailure(nonce);
    }

    @Test
    void enforcesConfiguredHostedDomainAllowlist() {
        String nonce = token("nonce-hosted-domain-allowlist");
        tokenClaims.set(validClaims(nonce, "allowed-hosted-domain", CLIENT_ID));

        OAuthProviderClient.ProviderIdentity allowed = exchange(
                adapter(Duration.ofSeconds(2), Set.of("example.com")), nonce);
        assertEquals("example.com", allowed.hostedDomain());

        tokenClaims.set(validClaims(nonce, "rejected-hosted-domain", CLIENT_ID,
                "person@gmail.com", "other.example.com", true));
        assertSanitizedFailure(nonce, Duration.ofSeconds(2), Set.of("example.com"));
    }

    @Test
    void rejectsMalformedSignedHostedDomainClaimsBeforeIdentityCreation() {
        String nonce = token("nonce-malformed-hosted-domain");
        tokenClaims.set(validClaims(nonce, "malformed-hosted-domain-url", CLIENT_ID,
                "person@example.net", "https://evil.example", true));
        assertSanitizedFailure(nonce);

        tokenClaims.set(validClaims(nonce, "malformed-hosted-domain-labels", CLIENT_ID,
                "person@example.net", "a..b", true));
        assertSanitizedFailure(nonce);
    }

    @Test
    void providerDenialTimeoutAndJwkFailureAreSanitized() {
        String nonce = token("nonce-provider-failure");
        resetEndpointHits();
        tokenStatus = 400;
        assertSanitizedFailure(nonce);
        assertEquals(1, tokenHits.get());
        assertEquals(0, jwksHits.get());

        resetEndpointHits();
        tokenStatus = 200;
        tokenDelay = Duration.ofMillis(500);
        assertSanitizedFailure(nonce, Duration.ofMillis(100));
        assertEquals(1, tokenHits.get());
        assertEquals(0, jwksHits.get());

        resetEndpointHits();
        tokenDelay = Duration.ZERO;
        jwksStatus = 503;
        assertSanitizedFailure(nonce);
        assertEquals(1, tokenHits.get());
        assertEquals(1, jwksHits.get());
    }

    @Test
    void discoveryFailureIsSanitizedAndDoesNotLeakConfiguration() {
        resetEndpointHits();
        discoveryStatus = 503;
        GoogleOidcAdapter adapter = adapter(Duration.ofMillis(100));

        DependencyUnavailableException exception = assertThrows(
                DependencyUnavailableException.class,
                () -> adapter.buildAuthorizationUrl(new OAuthProviderClient.AuthorizationRequest(
                        registration, new OAuthSecret(token("state-discovery")),
                        new OAuthSecret(token("nonce-discovery")), new OAuthSecret("C".repeat(43)))));

        assertEquals("A required authentication dependency is temporarily unavailable", exception.getMessage());
        assertFalse(exception.toString().contains(CLIENT_SECRET));
        assertEquals(1, discoveryHits.get());
        assertEquals(0, tokenHits.get());
        assertEquals(0, jwksHits.get());
    }

    private OAuthProviderClient.ProviderIdentity exchange(GoogleOidcAdapter adapter, String nonce) {
        return adapter.exchangeAuthorizationCode(new OAuthProviderClient.AuthorizationCodeRequest(
                registration,
                new OAuthSecret("provider-code"),
                new OAuthSecret("D".repeat(43)),
                fingerprint.fingerprint("oauth-google-nonce", nonce)));
    }

    private void assertSanitizedFailure(String nonce) {
        assertSanitizedFailure(nonce, Duration.ofSeconds(2));
    }

    private void assertSanitizedFailure(String nonce, Duration timeout) {
        assertSanitizedFailure(nonce, timeout, Set.of());
    }

    private void assertSanitizedFailure(String nonce, Duration timeout, Set<String> allowedHostedDomains) {
        DependencyUnavailableException exception = assertThrows(
                DependencyUnavailableException.class,
                () -> exchange(adapter(timeout, allowedHostedDomains), nonce));
        assertEquals("A required authentication dependency is temporarily unavailable", exception.getMessage());
        assertFalse(exception.toString().contains(CLIENT_SECRET));
        assertFalse(exception.toString().contains("provider-code"));
    }

    private GoogleOidcAdapter adapter(Duration timeout) {
        return adapter(timeout, Set.of());
    }

    private GoogleOidcAdapter adapter(Duration timeout, Set<String> allowedHostedDomains) {
        OAuthConfiguration configuration = OAuthConfiguration.enabled(
                registration,
                URI.create(ISSUER),
                new OAuthSecret(CLIENT_SECRET),
                Duration.ofMinutes(10),
                Duration.ofSeconds(60),
                Duration.ofMinutes(10),
                timeout,
                5,
                OAuthConfiguration.CookiePolicy.defaults(),
                allowedHostedDomains);
        return new GoogleOidcAdapter(
                configuration,
                objectMapper,
                fingerprint,
                Clock.fixed(NOW, ZoneOffset.UTC),
                discoveryUri);
    }

    private JWTClaimsSet validClaims(String nonce, String subject, String audience) {
        return validClaims(nonce, subject, List.of(audience), null, "person@gmail.com", "example.com", true);
    }

    private JWTClaimsSet validClaims(
            String nonce,
            String subject,
            String audience,
            String email,
            String hostedDomain,
            boolean emailVerified
    ) {
        return validClaims(nonce, subject, List.of(audience), null, email, hostedDomain, emailVerified);
    }

    private JWTClaimsSet validClaims(
            String nonce,
            String subject,
            List<String> audiences,
            String authorizedParty
    ) {
        return validClaims(nonce, subject, audiences, authorizedParty,
                "person@gmail.com", "example.com", true);
    }

    private JWTClaimsSet validClaims(
            String nonce,
            String subject,
            List<String> audiences,
            String authorizedParty,
            String email,
            String hostedDomain,
            boolean emailVerified
    ) {
        JWTClaimsSet.Builder builder = new JWTClaimsSet.Builder()
                .issuer(ISSUER)
                .subject(subject)
                .issueTime(Date.from(NOW.minusSeconds(5)))
                .expirationTime(Date.from(NOW.plusSeconds(300)))
                .claim("nonce", nonce)
                .claim("email_verified", emailVerified);
        if (audiences.size() == 1) {
            builder.audience(audiences.get(0));
        } else {
            builder.claim("aud", audiences);
        }
        if (authorizedParty != null) {
            builder.claim("azp", authorizedParty);
        }
        if (email != null) {
            builder.claim("email", email);
        }
        if (hostedDomain != null) {
            builder.claim("hd", hostedDomain);
        }
        return builder.build();
    }

    private static JWTClaimsSet.Builder copy(JWTClaimsSet claims) {
        return new JWTClaimsSet.Builder(claims);
    }

    private void handleDiscovery(HttpExchange exchange) throws IOException {
        discoveryHits.incrementAndGet();
        String body = objectMapper.writeValueAsString(Map.of(
                "issuer", ISSUER,
                "authorization_endpoint", endpoint("/authorize"),
                "token_endpoint", endpoint("/token"),
                "jwks_uri", endpoint("/jwks")));
        respond(exchange, discoveryStatus, body);
    }

    private void handleToken(HttpExchange exchange) throws IOException {
        tokenHits.incrementAndGet();
        if (!tokenDelay.isZero()) {
            try {
                Thread.sleep(tokenDelay.toMillis());
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                respond(exchange, 500, "{\"error\":\"interrupted\"}");
                return;
            }
        }
        lastTokenBody = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        lastAuthorizationHeader = exchange.getRequestHeaders().getFirst("Authorization");
        if (tokenStatus != 200) {
            respond(exchange, tokenStatus, "{\"error\":\"provider_denied\"}");
            return;
        }
        respond(exchange, 200, objectMapper.writeValueAsString(Map.of(
                "access_token", "provider-access-token",
                "token_type", "Bearer",
                "expires_in", 300,
                "id_token", signToken())));
    }

    private void handleJwks(HttpExchange exchange) throws IOException {
        jwksHits.incrementAndGet();
        String body = objectMapper.writeValueAsString(Map.of(
                "keys", List.of(signingKey.toPublicJWK().toJSONObject())));
        respond(exchange, jwksStatus, body);
    }

    private String signToken() throws IOException {
        try {
            JWSHeader header = new JWSHeader.Builder(tokenAlgorithm)
                    .keyID(tokenKey.get().getKeyID())
                    .type(JOSEObjectType.JWT)
                    .build();
            SignedJWT token = new SignedJWT(header, tokenClaims.get());
            if (macToken) {
                token.sign(new MACSigner(MAC_SECRET));
            } else {
                token.sign(new RSASSASigner(tokenKey.get()));
            }
            return token.serialize();
        } catch (Exception exception) {
            throw new IOException("could not sign provider fixture", exception);
        }
    }

    private void resetEndpointHits() {
        discoveryHits.set(0);
        tokenHits.set(0);
        jwksHits.set(0);
    }

    private String endpoint(String path) {
        return "http://127.0.0.1:" + server.getAddress().getPort() + path;
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private static String token(String seed) {
        try {
            return Base64.getUrlEncoder().withoutPadding().encodeToString(
                    MessageDigest.getInstance("SHA-256").digest(seed.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new AssertionError(exception);
        }
    }

    private static String urlEncoded(String value) {
        return java.net.URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String originAndPath(URI uri) {
        return uri.getScheme() + "://" + uri.getAuthority() + uri.getPath();
    }

    private static Map<String, String> query(URI uri) {
        Map<String, String> result = new LinkedHashMap<>();
        for (String pair : uri.getRawQuery().split("&")) {
            String[] parts = pair.split("=", 2);
            result.put(
                    URLDecoder.decode(parts[0], StandardCharsets.UTF_8),
                    URLDecoder.decode(parts.length == 1 ? "" : parts[1], StandardCharsets.UTF_8));
        }
        return result;
    }
}
