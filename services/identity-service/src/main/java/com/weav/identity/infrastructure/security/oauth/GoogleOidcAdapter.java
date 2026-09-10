package com.weav.identity.infrastructure.security.oauth;

import com.weav.identity.application.dto.OAuthConfiguration;
import com.weav.identity.application.dto.OAuthClientRegistration;
import com.weav.identity.application.dto.OAuthSecret;
import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OAuthProviderClient;
import com.weav.identity.application.validation.OAuthFingerprintPolicy;
import com.weav.identity.application.validation.OAuthProtocolPolicy;
import com.weav.identity.domain.exception.DependencyUnavailableException;
import com.weav.identity.domain.valueobject.OAuthProvider;
import com.weav.identity.infrastructure.config.OAuthEnabledCondition;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Conditional;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.security.oauth2.client.endpoint.OAuth2AuthorizationCodeGrantRequest;
import org.springframework.security.oauth2.client.endpoint.RestClientAuthorizationCodeTokenResponseClient;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.core.endpoint.OAuth2AccessTokenResponse;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationExchange;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationResponse;
import org.springframework.security.oauth2.core.http.converter.OAuth2AccessTokenResponseHttpMessageConverter;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Google authorization-code/OIDC adapter for the application provider port.
 *
 * <p>The registered client and issuer are fixed server configuration. The
 * request may carry only the opaque protocol values needed for this one
 * transaction; it cannot select a provider endpoint or substitute a client
 * registration. Spring Security's client, token-response and Nimbus JWK
 * primitives perform the protocol exchange and signature validation. Provider
 * access and refresh tokens are intentionally discarded after the ID token is
 * decoded.</p>
 */
@Conditional(OAuthEnabledCondition.class)
@Component
public final class GoogleOidcAdapter implements OAuthProviderClient {

    private static final String REGISTRATION_ID = "google";
    private static final String CODE_VERIFIER_ATTRIBUTE = "code_verifier";
    private static final Duration CLOCK_SKEW = Duration.ofSeconds(60);
    private static final OAuth2Error INVALID_TOKEN = new OAuth2Error("invalid_token");
    private static final Set<String> SCOPES = Set.of("openid", "email", "profile");

    private final OAuthConfiguration configuration;
    private final ObjectMapper objectMapper;
    private final KeyedFingerprint keyedFingerprint;
    private final Clock clock;
    private final URI discoveryUriOverride;
    private volatile ProviderRuntime providerRuntime;

    @Autowired
    public GoogleOidcAdapter(
            OAuthConfiguration configuration,
            ObjectMapper objectMapper,
            KeyedFingerprint keyedFingerprint,
            Clock clock
    ) {
        this(configuration, objectMapper, keyedFingerprint, clock, null);
    }

    /**
     * Test-only constructor that redirects discovery to a disposable local
     * HTTP provider. Production wiring always derives discovery from the
     * validated HTTPS issuer and never accepts an endpoint override.
     */
    GoogleOidcAdapter(
            OAuthConfiguration configuration,
            ObjectMapper objectMapper,
            KeyedFingerprint keyedFingerprint,
            Clock clock,
            URI discoveryUriOverride
    ) {
        this.configuration = Objects.requireNonNull(configuration, "configuration must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.keyedFingerprint = Objects.requireNonNull(keyedFingerprint, "keyedFingerprint must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
        this.discoveryUriOverride = discoveryUriOverride;
    }

    @Override
    public AuthorizationUrl buildAuthorizationUrl(AuthorizationRequest request) {
        requireEnabled();
        Objects.requireNonNull(request, "request must not be null");
        OAuthClientRegistration registration = requireConfiguredRegistration(request.clientRegistration());
        String state = OAuthProtocolPolicy.requireOpaqueToken(request.state().value(), "state");
        String nonce = OAuthProtocolPolicy.requireOpaqueToken(request.nonce().value(), "nonce");
        String verifier = OAuthProtocolPolicy.requireVerifier(request.providerCodeVerifier().value());

        ProviderRuntime runtime = runtime();
        OAuth2AuthorizationRequest authorizationRequest = OAuth2AuthorizationRequest.authorizationCode()
                .authorizationUri(runtime.registration().getProviderDetails().getAuthorizationUri())
                .clientId(runtime.registration().getClientId())
                .redirectUri(registration.providerCallbackUri().toString())
                .scopes(SCOPES)
                .state(state)
                .additionalParameters(Map.of(
                        "nonce", nonce,
                        "code_challenge", OAuthProtocolPolicy.challengeForVerifier(verifier),
                        "code_challenge_method", OAuthProtocolPolicy.S256
                ))
                .build();
        return new AuthorizationUrl(URI.create(authorizationRequest.getAuthorizationRequestUri()));
    }

    @Override
    public ProviderIdentity exchangeAuthorizationCode(AuthorizationCodeRequest request) {
        requireEnabled();
        Objects.requireNonNull(request, "request must not be null");
        OAuthClientRegistration registration = requireConfiguredRegistration(request.clientRegistration());
        String authorizationCode = requireProviderCode(request.authorizationCode());
        String providerCodeVerifier = OAuthProtocolPolicy.requireVerifier(request.providerCodeVerifier().value());

        try {
            ProviderRuntime runtime = runtime();
            OAuth2AuthorizationRequest authorizationRequest = OAuth2AuthorizationRequest.authorizationCode()
                    .authorizationUri(runtime.registration().getProviderDetails().getAuthorizationUri())
                    .clientId(runtime.registration().getClientId())
                    .redirectUri(registration.providerCallbackUri().toString())
                    .scopes(SCOPES)
                    .state(request.expectedNonceFingerprint())
                    .attributes(Map.of(CODE_VERIFIER_ATTRIBUTE, providerCodeVerifier))
                    .build();
            OAuth2AuthorizationResponse authorizationResponse = OAuth2AuthorizationResponse
                    .success(authorizationCode)
                    .redirectUri(registration.providerCallbackUri().toString())
                    .state(request.expectedNonceFingerprint())
                    .build();
            OAuth2AuthorizationExchange exchange = new OAuth2AuthorizationExchange(
                    authorizationRequest, authorizationResponse);
            OAuth2AccessTokenResponse tokenResponse = runtime.tokenClient().getTokenResponse(
                    new OAuth2AuthorizationCodeGrantRequest(runtime.registration(), exchange));
            Object idTokenValue = tokenResponse.getAdditionalParameters().get("id_token");
            if (!(idTokenValue instanceof String idToken) || idToken.isBlank()) {
                throw new IllegalArgumentException("provider response did not contain an ID token");
            }
            Jwt jwt = runtime.decoder().decode(idToken);
            return toProviderIdentity(jwt, request.expectedNonceFingerprint(), runtime.registration().getClientId());
        } catch (DependencyUnavailableException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
    }

    private ProviderIdentity toProviderIdentity(Jwt jwt, String expectedNonceFingerprint, String clientId) {
        Map<String, Object> claims = jwt.getClaims();
        validateAlgorithm(jwt);
        validateNonce(claims, expectedNonceFingerprint);
        validateIssuedAtClaim(jwt);

        String subject = requiredStringClaim(claims, "sub", 1, 255);
        String email = optionalStringClaim(claims, "email", 1, 254);
        boolean emailVerified = optionalBooleanClaim(claims, "email_verified");
        String hostedDomain = optionalStringClaim(claims, "hd", 1, 253);
        if (hostedDomain != null && !OAuthProtocolPolicy.isValidHostedDomain(hostedDomain)) {
            throw new IllegalArgumentException("provider hosted domain is malformed");
        }
        if (!configuration.allowedHostedDomains().isEmpty()
                && (hostedDomain == null
                || !configuration.allowedHostedDomains().contains(hostedDomain.toLowerCase(Locale.ROOT)))) {
            throw new IllegalArgumentException("provider hosted domain is not allowed");
        }
        return new ProviderIdentity(
                OAuthProvider.GOOGLE,
                subject,
                email,
                emailVerified,
                hostedDomain,
                Objects.requireNonNull(jwt.getIssuedAt(), "issuedAt must not be null")
        );
    }

    private ProviderRuntime runtime() {
        ProviderRuntime current = providerRuntime;
        if (current != null) {
            return current;
        }
        synchronized (this) {
            current = providerRuntime;
            if (current == null) {
                current = buildRuntime();
                providerRuntime = current;
            }
            return current;
        }
    }

    private ProviderRuntime buildRuntime() {
        URI issuer = configuredIssuer();
        ProviderEndpoints endpoints = discover(issuer);
        OAuthClientRegistration configuredRegistration = configuration.webClient().orElseThrow(
                DependencyUnavailableException::new);
        ClientRegistration registration = ClientRegistration.withRegistrationId(REGISTRATION_ID)
                .clientId(configuredRegistration.providerClientId())
                .clientSecret(configuration.clientSecret().orElseThrow(DependencyUnavailableException::new).value())
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri(configuredRegistration.providerCallbackUri().toString())
                .scope(SCOPES)
                .authorizationUri(endpoints.authorizationUri().toString())
                .tokenUri(endpoints.tokenUri().toString())
                .jwkSetUri(endpoints.jwkSetUri().toString())
                .issuerUri(issuer.toString())
                .clientName("Google")
                .clientSettings(ClientRegistration.ClientSettings.builder().requireProofKey(true).build())
                .build();

        RestTemplate jwkRestOperations = newRestTemplate();
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(endpoints.jwkSetUri().toString())
                .jwsAlgorithm(SignatureAlgorithm.RS256)
                .restOperations(jwkRestOperations)
                .build();
        decoder.setJwtValidator(jwtValidator(issuer, configuredRegistration.providerClientId()));

        RestClientAuthorizationCodeTokenResponseClient tokenClient =
                new RestClientAuthorizationCodeTokenResponseClient();
        tokenClient.setRestClient(RestClient.builder()
                .requestFactory(newRequestFactory())
                // Put the OAuth response converter ahead of the generic JSON converter.
                // Otherwise RestClient can instantiate OAuth2AccessTokenResponse directly,
                // losing the provider's id_token additional parameter.
                .messageConverters(converters -> converters.add(0,
                        new OAuth2AccessTokenResponseHttpMessageConverter()))
                .build());
        return new ProviderRuntime(registration, decoder, tokenClient);
    }

    private ProviderEndpoints discover(URI issuer) {
        URI discoveryUri = discoveryUri(issuer);
        try {
            ResponseEntity<String> response = newRestTemplate().getForEntity(discoveryUri, String.class);
            if (!response.getStatusCode().is2xxSuccessful() || !StringUtils.hasText(response.getBody())) {
                throw new IllegalArgumentException("provider discovery response was not usable");
            }
            JsonNode metadata = objectMapper.readTree(response.getBody());
            String metadataIssuer = text(metadata, "issuer");
            if (!issuerMatches(metadataIssuer, issuer)) {
                throw new IllegalArgumentException("provider discovery issuer did not match configuration");
            }
            boolean allowInsecureTestEndpoints = discoveryUriOverride != null;
            return new ProviderEndpoints(
                    providerEndpoint(metadata, "authorization_endpoint", allowInsecureTestEndpoints),
                    providerEndpoint(metadata, "token_endpoint", allowInsecureTestEndpoints),
                    providerEndpoint(metadata, "jwks_uri", allowInsecureTestEndpoints)
            );
        } catch (DependencyUnavailableException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new DependencyUnavailableException();
        }
    }

    private URI discoveryUri(URI issuer) {
        if (discoveryUriOverride != null) {
            if (!"http".equalsIgnoreCase(discoveryUriOverride.getScheme())
                    && !"https".equalsIgnoreCase(discoveryUriOverride.getScheme())) {
                throw new IllegalArgumentException("test discovery endpoint must use HTTP or HTTPS");
            }
            return discoveryUriOverride;
        }
        String issuerValue = issuer.toString();
        if (issuerValue.endsWith("/")) {
            issuerValue = issuerValue.substring(0, issuerValue.length() - 1);
        }
        return URI.create(issuerValue + "/.well-known/openid-configuration");
    }

    private URI providerEndpoint(JsonNode metadata, String name, boolean allowInsecureTestEndpoints) {
        URI endpoint = URI.create(text(metadata, name));
        if (!endpoint.isAbsolute()
                || endpoint.getUserInfo() != null
                || endpoint.getFragment() != null
                || endpoint.getRawQuery() != null
                || (!"https".equalsIgnoreCase(endpoint.getScheme())
                && !(allowInsecureTestEndpoints && "http".equalsIgnoreCase(endpoint.getScheme())))) {
            throw new IllegalArgumentException("provider endpoint is not safe");
        }
        return endpoint;
    }

    private RestTemplate newRestTemplate() {
        return new RestTemplate(newRequestFactory());
    }

    private JdkClientHttpRequestFactory newRequestFactory() {
        Duration timeout = configuration.providerTimeout();
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(timeout)
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(timeout);
        return factory;
    }

    private OAuth2TokenValidator<Jwt> jwtValidator(URI issuer, String clientId) {
        JwtTimestampValidator timestamp = new JwtTimestampValidator(CLOCK_SKEW);
        timestamp.setClock(clock);
        timestamp.setAllowEmptyExpiryClaim(false);
        timestamp.setAllowEmptyNotBeforeClaim(true);
        return new DelegatingOAuth2TokenValidator<>(
                timestamp,
                token -> validateIssuer(token, issuer),
                token -> validateAudience(token, clientId),
                this::validateIssuedAtClaim
        );
    }

    private OAuth2TokenValidatorResult validateIssuer(Jwt token, URI issuer) {
        return issuerMatches(stringClaim(token.getClaims(), "iss"), issuer)
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(INVALID_TOKEN);
    }

    private OAuth2TokenValidatorResult validateAudience(Jwt token, String clientId) {
        try {
            List<String> audiences = audienceClaim(token.getClaims().get("aud"));
            if (!audiences.contains(clientId)) {
                return OAuth2TokenValidatorResult.failure(INVALID_TOKEN);
            }
            Object authorizedParty = token.getClaims().get("azp");
            if (audiences.size() > 1 && !(authorizedParty instanceof String)) {
                return OAuth2TokenValidatorResult.failure(INVALID_TOKEN);
            }
            if (authorizedParty != null
                    && (!(authorizedParty instanceof String) || !clientId.equals(authorizedParty))) {
                return OAuth2TokenValidatorResult.failure(INVALID_TOKEN);
            }
            return OAuth2TokenValidatorResult.success();
        } catch (RuntimeException exception) {
            return OAuth2TokenValidatorResult.failure(INVALID_TOKEN);
        }
    }

    private OAuth2TokenValidatorResult validateIssuedAtClaim(Jwt token) {
        Instant issuedAt = token.getIssuedAt();
        return issuedAt != null && !issuedAt.isAfter(clock.instant().plus(CLOCK_SKEW))
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(INVALID_TOKEN);
    }

    private void validateAlgorithm(Jwt jwt) {
        if (!"RS256".equals(jwt.getHeaders().get("alg"))) {
            throw new IllegalArgumentException("provider token used an unsupported algorithm");
        }
    }

    private void validateNonce(Map<String, Object> claims, String expectedNonceFingerprint) {
        String nonce = stringClaim(claims, "nonce");
        String actualFingerprint = OAuthFingerprintPolicy.googleNonce(keyedFingerprint, nonce);
        if (!MessageDigest.isEqual(
                actualFingerprint.getBytes(StandardCharsets.US_ASCII),
                expectedNonceFingerprint.getBytes(StandardCharsets.US_ASCII))) {
            throw new IllegalArgumentException("provider nonce did not match transaction");
        }
    }

    private OAuthClientRegistration requireConfiguredRegistration(OAuthClientRegistration requested) {
        OAuthClientRegistration configured = configuration.webClient().orElseThrow(
                DependencyUnavailableException::new);
        if (!configured.equals(requested) || configured.provider() != OAuthProvider.GOOGLE) {
            throw new IllegalArgumentException("OAuth client registration does not match configured registration");
        }
        return configured;
    }

    private void requireEnabled() {
        if (!configuration.enabled()) {
            throw new DependencyUnavailableException();
        }
    }

    private URI configuredIssuer() {
        URI issuer = configuration.issuerUri().orElseThrow(DependencyUnavailableException::new);
        if (!OAuthConfiguration.GOOGLE_ISSUER_URI.equals(issuer)) {
            throw new IllegalArgumentException("Google OAuth issuer must be https://accounts.google.com");
        }
        return issuer;
    }

    private static String requireProviderCode(OAuthSecret authorizationCode) {
        String value = authorizationCode.value();
        if (value.length() < 1 || value.length() > 2048
                || value.chars().anyMatch(character -> character < 0x20 || character > 0x7e)) {
            throw new IllegalArgumentException("authorization code must be printable ASCII of length 1..2048");
        }
        return value;
    }

    private static String text(JsonNode metadata, String field) {
        JsonNode value = metadata == null ? null : metadata.get(field);
        if (value == null || !value.isTextual() || !StringUtils.hasText(value.asText())) {
            throw new IllegalArgumentException("provider metadata field is missing");
        }
        return value.asText();
    }

    private static String stringClaim(Map<String, Object> claims, String name) {
        Object value = claims.get(name);
        if (!(value instanceof String string) || !StringUtils.hasText(string)) {
            throw new IllegalArgumentException("provider claim is missing or malformed");
        }
        return string;
    }

    private static String requiredStringClaim(Map<String, Object> claims, String name, int minimum, int maximum) {
        String value = stringClaim(claims, name);
        if (value.length() < minimum || value.length() > maximum
                || value.chars().anyMatch(character -> character < 0x20 || character > 0x7e)) {
            throw new IllegalArgumentException("provider claim is outside its bound");
        }
        return value;
    }

    private static String optionalStringClaim(Map<String, Object> claims, String name, int minimum, int maximum) {
        if (!claims.containsKey(name) || claims.get(name) == null) {
            return null;
        }
        return requiredStringClaim(claims, name, minimum, maximum);
    }

    private static boolean optionalBooleanClaim(Map<String, Object> claims, String name) {
        if (!claims.containsKey(name) || claims.get(name) == null) {
            return false;
        }
        if (!(claims.get(name) instanceof Boolean value)) {
            throw new IllegalArgumentException("provider boolean claim is malformed");
        }
        return value;
    }

    private static List<String> audienceClaim(Object value) {
        if (value instanceof String audience && StringUtils.hasText(audience)) {
            return List.of(audience);
        }
        if (value instanceof Collection<?> audiences && !audiences.isEmpty()
                && audiences.stream().allMatch(item -> item instanceof String string && StringUtils.hasText(string))) {
            return audiences.stream().map(String.class::cast).toList();
        }
        throw new IllegalArgumentException("provider audience claim is malformed");
    }

    private static boolean issuerMatches(String actual, URI expected) {
        String expectedValue = expected.toString();
        return expectedValue.equals(actual)
                || ("https://accounts.google.com".equals(expectedValue)
                && "accounts.google.com".equals(actual));
    }

    private record ProviderEndpoints(URI authorizationUri, URI tokenUri, URI jwkSetUri) {
    }

    private record ProviderRuntime(
            ClientRegistration registration,
            JwtDecoder decoder,
            RestClientAuthorizationCodeTokenResponseClient tokenClient
    ) {
    }
}
