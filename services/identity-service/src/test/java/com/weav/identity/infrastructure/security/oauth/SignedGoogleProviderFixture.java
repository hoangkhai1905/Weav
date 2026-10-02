package com.weav.identity.infrastructure.security.oauth;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.weav.identity.application.dto.OAuthClientRegistration;
import com.weav.identity.application.dto.OAuthConfiguration;
import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.domain.valueobject.OAuthProvider;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Small signed local Google OIDC fixture for coordinator composition tests.
 * It is test-only; production adapter construction still derives discovery
 * from the validated Google issuer and never accepts an endpoint override.
 */
public final class SignedGoogleProviderFixture implements AutoCloseable {

    public static final Instant NOW = Instant.parse("2026-09-10T00:00:00Z");
    public static final String ISSUER = "https://accounts.google.com";
    public static final String CLIENT_ID = "signed-google-client";

    private final ObjectMapper objectMapper = JsonMapper.builder().findAndAddModules().build();
    private final HttpServer server;
    private final RSAKey signingKey;
    private final AtomicReference<JWTClaimsSet> tokenClaims = new AtomicReference<>();
    private final AtomicInteger tokenHits = new AtomicInteger();
    private final AtomicInteger jwksHits = new AtomicInteger();
    private final URI discoveryUri;

    private SignedGoogleProviderFixture() throws Exception {
        signingKey = new RSAKeyGenerator(2048).keyID("signed-provider-kid").generate();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        discoveryUri = endpoint("/.well-known/openid-configuration");
        server.createContext("/.well-known/openid-configuration", this::handleDiscovery);
        server.createContext("/authorize", this::handleAuthorize);
        server.createContext("/token", this::handleToken);
        server.createContext("/jwks", this::handleJwks);
        server.start();
    }

    public static SignedGoogleProviderFixture start() {
        try {
            return new SignedGoogleProviderFixture();
        } catch (Exception exception) {
            throw new AssertionError("could not start signed Google fixture", exception);
        }
    }

    public OAuthClientRegistration registration() {
        return new OAuthClientRegistration(
                "web",
                "web",
                OAuthProvider.GOOGLE,
                CLIENT_ID,
                endpoint("/auth/callback"),
                endpoint("/return"),
                java.util.Set.of(origin()));
    }

    public GoogleOidcAdapter adapter(
            OAuthConfiguration configuration,
            KeyedFingerprint keyedFingerprint,
            Clock clock
    ) {
        return new GoogleOidcAdapter(
                configuration,
                objectMapper,
                keyedFingerprint,
                clock,
                discoveryUri);
    }

    public void setIdentity(String nonce, String subject, String email, boolean emailVerified) {
        setIdentity(nonce, subject, email, emailVerified, NOW);
    }

    public void setIdentity(
            String nonce,
            String subject,
            String email,
            boolean emailVerified,
            Instant now
    ) {
        JWTClaimsSet.Builder builder = new JWTClaimsSet.Builder()
                .issuer(ISSUER)
                .subject(subject)
                .audience(CLIENT_ID)
                .issueTime(java.util.Date.from(now.minusSeconds(5)))
                .expirationTime(java.util.Date.from(now.plusSeconds(300)))
                .claim("nonce", nonce)
                .claim("email_verified", emailVerified);
        if (email != null) {
            builder.claim("email", email);
        }
        tokenClaims.set(builder.build());
    }

    public int tokenHits() {
        return tokenHits.get();
    }

    public int jwksHits() {
        return jwksHits.get();
    }

    public void resetHits() {
        tokenHits.set(0);
        jwksHits.set(0);
    }

    @Override
    public void close() {
        server.stop(0);
    }

    private void handleDiscovery(HttpExchange exchange) throws IOException {
        Map<String, String> metadata = new LinkedHashMap<>();
        metadata.put("issuer", ISSUER);
        metadata.put("authorization_endpoint", endpoint("/authorize").toString());
        metadata.put("token_endpoint", endpoint("/token").toString());
        metadata.put("jwks_uri", endpoint("/jwks").toString());
        respond(exchange, 200, objectMapper.writeValueAsString(metadata));
    }

    /** Browser-only authorization redirect; no real provider account is used. */
    private void handleAuthorize(HttpExchange exchange) throws IOException {
        String redirectUri = queryParameter(exchange.getRequestURI(), "redirect_uri");
        String state = queryParameter(exchange.getRequestURI(), "state");
        String nonce = queryParameter(exchange.getRequestURI(), "nonce");
        if (redirectUri == null || state == null || nonce == null) {
            respond(exchange, 400, "{}");
            return;
        }
        URI redirect = URI.create(redirectUri);
        if (!("localhost".equalsIgnoreCase(redirect.getHost())
                || "127.0.0.1".equals(redirect.getHost()))) {
            respond(exchange, 400, "{}");
            return;
        }
        setIdentity(nonce, "browser-fixture-subject", "browser-fixture@gmail.com", true, Instant.now());
        String separator = redirect.getRawQuery() == null ? "?" : "&";
        URI callback = URI.create(redirect + separator
                + "code=browser-fixture-code&state="
                + URLEncoder.encode(state, java.nio.charset.StandardCharsets.UTF_8));
        exchange.getResponseHeaders().set("Location", callback.toString());
        exchange.sendResponseHeaders(302, -1);
        exchange.close();
    }

    private void handleToken(HttpExchange exchange) throws IOException {
        tokenHits.incrementAndGet();
        String idToken;
        try {
            JWTClaimsSet claims = tokenClaims.get();
            if (claims == null) {
                throw new IllegalStateException("fixture token claims were not configured");
            }
            SignedJWT token = new SignedJWT(
                    new JWSHeader.Builder(JWSAlgorithm.RS256)
                            .keyID(signingKey.getKeyID())
                            .type(JOSEObjectType.JWT)
                            .build(),
                    claims);
            token.sign(new RSASSASigner(signingKey));
            idToken = token.serialize();
        } catch (Exception exception) {
            throw new IOException("could not sign fixture token", exception);
        }
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("access_token", "provider-access-token");
        response.put("token_type", "Bearer");
        response.put("expires_in", 300);
        response.put("id_token", idToken);
        respond(exchange, 200, objectMapper.writeValueAsString(response));
    }

    private void handleJwks(HttpExchange exchange) throws IOException {
        jwksHits.incrementAndGet();
        respond(exchange, 200, objectMapper.writeValueAsString(Map.of(
                "keys", List.of(signingKey.toPublicJWK().toJSONObject()))));
    }

    private void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private static String queryParameter(URI uri, String name) {
        if (uri.getRawQuery() == null) {
            return null;
        }
        for (String part : uri.getRawQuery().split("&")) {
            String[] keyValue = part.split("=", 2);
            String key = URLDecoder.decode(keyValue[0], java.nio.charset.StandardCharsets.UTF_8);
            if (name.equals(key)) {
                return URLDecoder.decode(
                        keyValue.length == 1 ? "" : keyValue[1],
                        java.nio.charset.StandardCharsets.UTF_8);
            }
        }
        return null;
    }

    private URI endpoint(String path) {
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort() + path);
    }

    private String origin() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }
}
