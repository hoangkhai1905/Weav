package com.weav.workspace.infrastructure.provider.google;

import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.dto.GoogleOAuthRefreshResponse;
import com.weav.workspace.application.dto.GoogleOAuthTokenResponse;
import com.weav.workspace.application.port.out.GoogleOAuthPort;
import com.weav.workspace.application.service.GoogleOAuthScopePolicy;
import com.weav.workspace.domain.exception.AuthenticationRejectedException;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.infrastructure.config.GoogleOAuthProperties;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Fixed-endpoint Google OAuth adapter with bounded bodies and redirects disabled by its client. */
public final class GoogleOAuthProvider implements GoogleOAuthPort {

    private static final URI AUTHORIZATION_ENDPOINT = URI.create("https://accounts.google.com/o/oauth2/v2/auth");
    private static final URI TOKEN_ENDPOINT = URI.create("https://oauth2.googleapis.com/token");
    private static final URI GMAIL_PROFILE_ENDPOINT = URI.create(
            "https://gmail.googleapis.com/gmail/v1/users/me/profile");
    private static final URI TOKEN_INFO_ENDPOINT = URI.create("https://www.googleapis.com/oauth2/v2/tokeninfo");
    private static final int MAX_RESPONSE_BYTES = 64 * 1024;
    private static final int MAX_AUTHORIZATION_CODE_LENGTH = 8192;
    private static final int MAX_TOKEN_LENGTH = 16 * 1024;
    private static final int MAX_SCOPE_COUNT = 64;
    private static final int MAX_SCOPE_LENGTH = 1024;

    private final RestClient restClient;
    private final GoogleOAuthProperties properties;
    private final GoogleOAuthScopePolicy scopePolicy;
    private final ObjectMapper objectMapper;
    private final Endpoints endpoints;

    public GoogleOAuthProvider(
            RestClient restClient,
            GoogleOAuthProperties properties,
            GoogleOAuthScopePolicy scopePolicy,
            ObjectMapper objectMapper) {
        this(restClient, properties, scopePolicy, objectMapper,
                new Endpoints(AUTHORIZATION_ENDPOINT, TOKEN_ENDPOINT,
                        GMAIL_PROFILE_ENDPOINT, TOKEN_INFO_ENDPOINT));
    }

    GoogleOAuthProvider(
            RestClient restClient,
            GoogleOAuthProperties properties,
            GoogleOAuthScopePolicy scopePolicy,
            ObjectMapper objectMapper,
            Endpoints endpoints) {
        this.restClient = Objects.requireNonNull(restClient, "restClient must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.scopePolicy = Objects.requireNonNull(scopePolicy, "scopePolicy must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.endpoints = Objects.requireNonNull(endpoints, "endpoints must not be null");
    }

    @Override
    public String authorizationUrl(ConnectionProvider provider, String state) {
        List<String> scopes = scopePolicy.requiredScopes(provider);
        requireConfiguredClient();
        if (!isSafeState(state)) {
            throw new BadRequestException("Google authorization state is invalid");
        }
        StringBuilder url = new StringBuilder(endpoints.authorization().toString()).append('?');
        appendQuery(url, "client_id", properties.clientId());
        appendQuery(url, "redirect_uri", properties.redirectUri().toString());
        appendQuery(url, "response_type", "code");
        appendQuery(url, "scope", String.join(" ", scopes));
        appendQuery(url, "state", state);
        appendQuery(url, "access_type", "offline");
        appendQuery(url, "include_granted_scopes", "true");
        appendQuery(url, "prompt", "consent");
        return url.substring(0, url.length() - 1);
    }

    @Override
    public GoogleOAuthTokenResponse exchangeAuthorizationCode(String authorizationCode) {
        requireConfiguredClient();
        if (!isValidAuthorizationCode(authorizationCode)) {
            throw new BadRequestException("Google authorization response is invalid");
        }
        Map<String, String> form = new LinkedHashMap<>();
        form.put("client_id", properties.clientId());
        form.put("client_secret", properties.clientSecret());
        form.put("code", authorizationCode);
        form.put("grant_type", "authorization_code");
        form.put("redirect_uri", properties.redirectUri().toString());

        HttpResponse response = postForm(endpoints.token(), form);
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            classifyExchangeFailure(response);
        }
        JsonNode payload = parseObject(response.body());
        String accessToken = requiredText(payload, "access_token");
        String tokenType = requiredText(payload, "token_type");
        JsonNode refresh = payload.get("refresh_token");
        if (refresh == null || !refresh.isTextual() || refresh.asText().isBlank()) {
            // Never pair a new account's access token with an old refresh token.
            throw new BadRequestException(
                    "Google did not issue an offline refresh token; reconnect and grant access");
        }
        long expiresIn = requiredPositiveLong(payload, "expires_in");
        List<String> scopes;
        try {
            scopes = parseScopes(requiredText(payload, "scope"));
        } catch (InvalidGoogleResponseException exception) {
            throw new DependencyUnavailableException();
        }
        try {
            return new GoogleOAuthTokenResponse(
                    accessToken, refresh.asText(), tokenType, scopes, expiresIn);
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
    }

    @Override
    public GoogleOAuthRefreshResponse refreshAccessToken(String refreshToken) {
        requireConfiguredClient();
        if (!isValidToken(refreshToken)) {
            throw new DependencyUnavailableException();
        }
        Map<String, String> form = new LinkedHashMap<>();
        form.put("client_id", properties.clientId());
        form.put("client_secret", properties.clientSecret());
        form.put("refresh_token", refreshToken);
        form.put("grant_type", "refresh_token");

        HttpResponse response = postForm(endpoints.token(), form);
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            classifyRefreshFailure(response);
        }
        JsonNode payload = parseObject(response.body());
        String accessToken = requiredText(payload, "access_token");
        String tokenType = requiredText(payload, "token_type");
        long expiresIn = requiredPositiveLong(payload, "expires_in");
        List<String> scopes;
        try {
            scopes = parseScopes(requiredText(payload, "scope"));
        } catch (InvalidGoogleResponseException exception) {
            throw new DependencyUnavailableException();
        }

        JsonNode refresh = payload.get("refresh_token");
        String replacementRefreshToken = null;
        if (refresh != null) {
            if (!refresh.isTextual() || refresh.asText().isBlank() || !isValidToken(refresh.asText())) {
                throw new DependencyUnavailableException();
            }
            replacementRefreshToken = refresh.asText();
        }
        try {
            return new GoogleOAuthRefreshResponse(
                    accessToken, replacementRefreshToken, tokenType, scopes, expiresIn);
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
    }

    @Override
    public ConnectionTestResult verify(
            ConnectionProvider provider,
            String accessToken,
            List<String> grantedScopes) {
        scopePolicy.requiredScopes(provider);
        if (!scopePolicy.containsRequiredScopes(provider, grantedScopes)
                || !isValidToken(accessToken)) {
            return ConnectionTestResult.authInvalid();
        }
        requireConfiguredClient();
        return provider == ConnectionProvider.GMAIL
                ? verifyGmail(accessToken)
                : verifySheets(accessToken, provider);
    }

    private ConnectionTestResult verifyGmail(String accessToken) {
        HttpResponse response;
        try {
            response = getWithBearer(endpoints.gmailProfile(), accessToken);
        } catch (DependencyUnavailableException exception) {
            return ConnectionTestResult.dependencyFailure();
        }
        if (response.statusCode() == 401) {
            return ConnectionTestResult.authInvalid();
        }
        if (!isSuccess(response.statusCode())) {
            return ConnectionTestResult.dependencyFailure();
        }
        JsonNode profile = parseObjectOrNull(response.body());
        JsonNode emailAddress = profile == null ? null : profile.get("emailAddress");
        return emailAddress != null && emailAddress.isTextual() && !emailAddress.asText().isBlank()
                ? ConnectionTestResult.verified()
                : ConnectionTestResult.dependencyFailure();
    }

    private ConnectionTestResult verifySheets(String accessToken, ConnectionProvider provider) {
        HttpResponse response;
        try {
            response = postWithQueryParameter(endpoints.tokenInfo(), "access_token", accessToken);
        } catch (DependencyUnavailableException exception) {
            return ConnectionTestResult.dependencyFailure();
        }
        if (isConfirmedInvalidToken(response)) {
            return ConnectionTestResult.authInvalid();
        }
        if (!isSuccess(response.statusCode())) {
            return ConnectionTestResult.dependencyFailure();
        }
        JsonNode tokenInfo = parseObjectOrNull(response.body());
        if (tokenInfo == null) {
            return ConnectionTestResult.dependencyFailure();
        }
        JsonNode scopeNode = tokenInfo.get("scope");
        if (scopeNode == null || !scopeNode.isTextual()) {
            return ConnectionTestResult.dependencyFailure();
        }
        List<String> actualScopes;
        try {
            actualScopes = parseScopes(scopeNode.asText());
        } catch (RuntimeException exception) {
            return ConnectionTestResult.dependencyFailure();
        }
        if (!scopePolicy.containsRequiredScopes(provider, actualScopes)) {
            return ConnectionTestResult.authInvalid();
        }
        if (!audienceMatches(tokenInfo)) {
            return ConnectionTestResult.authInvalid();
        }
        return ConnectionTestResult.verified();
    }

    private boolean audienceMatches(JsonNode tokenInfo) {
        for (String field : List.of("issued_to", "audience", "aud")) {
            JsonNode value = tokenInfo.get(field);
            if (value != null && value.isTextual() && !value.asText().isBlank()) {
                return properties.clientId().equals(value.asText());
            }
        }
        return true;
    }

    private boolean isConfirmedInvalidToken(HttpResponse response) {
        if (response.statusCode() == 401) {
            return true;
        }
        if (response.statusCode() != 400 && response.statusCode() != 403) {
            return false;
        }
        JsonNode error = parseObjectOrNull(response.body());
        JsonNode code = error == null ? null : error.get("error");
        return code != null && code.isTextual() && "invalid_token".equals(code.asText());
    }

    private void classifyExchangeFailure(HttpResponse response) {
        if (response.statusCode() == 400 || response.statusCode() == 401) {
            String error = oauthErrorCode(response.body());
            if ("invalid_grant".equals(error) || "access_denied".equals(error)) {
                throw new BadRequestException("Google authorization response is invalid or expired");
            }
        }
        throw new DependencyUnavailableException();
    }

    private void classifyRefreshFailure(HttpResponse response) {
        if (response.statusCode() == 400 && "invalid_grant".equals(oauthErrorCode(response.body()))) {
            throw new AuthenticationRejectedException();
        }
        throw new DependencyUnavailableException();
    }

    private String oauthErrorCode(byte[] body) {
        JsonNode payload = parseObjectOrNull(body);
        JsonNode error = payload == null ? null : payload.get("error");
        if (error == null || !error.isTextual()) {
            return null;
        }
        String value = error.asText();
        return value.length() <= 64 && value.codePoints().noneMatch(Character::isISOControl)
                ? value
                : null;
    }

    private HttpResponse postForm(URI uri, Map<String, String> form) {
        try {
            return restClient.post()
                    .uri(uri)
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .accept(MediaType.APPLICATION_JSON)
                    .body(encodeForm(form))
                    .exchange((request, response) -> new HttpResponse(
                            response.getStatusCode().value(), readBounded(response.getBody())));
        } catch (RuntimeException exception) {
            if (exception instanceof DependencyUnavailableException dependencyUnavailableException) {
                throw dependencyUnavailableException;
            }
            if (exception instanceof RestClientException) {
                throw new DependencyUnavailableException();
            }
            throw new DependencyUnavailableException();
        }
    }

    private HttpResponse postWithQueryParameter(URI uri, String name, String value) {
        String separator = uri.getRawQuery() == null ? "?" : "&";
        URI requestUri = URI.create(uri + separator
                + URLEncoder.encode(name, StandardCharsets.UTF_8)
                + "=" + URLEncoder.encode(value, StandardCharsets.UTF_8));
        try {
            return restClient.post()
                    .uri(requestUri)
                    .accept(MediaType.APPLICATION_JSON)
                    .exchange((request, response) -> new HttpResponse(
                            response.getStatusCode().value(), readBounded(response.getBody())));
        } catch (RuntimeException exception) {
            if (exception instanceof DependencyUnavailableException dependencyUnavailableException) {
                throw dependencyUnavailableException;
            }
            if (exception instanceof RestClientException) {
                throw new DependencyUnavailableException();
            }
            throw new DependencyUnavailableException();
        }
    }

    private HttpResponse getWithBearer(URI uri, String accessToken) {
        try {
            return restClient.get()
                    .uri(uri)
                    .header("Authorization", "Bearer " + accessToken)
                    .accept(MediaType.APPLICATION_JSON)
                    .exchange((request, response) -> new HttpResponse(
                            response.getStatusCode().value(), readBounded(response.getBody())));
        } catch (RuntimeException exception) {
            if (exception instanceof DependencyUnavailableException dependencyUnavailableException) {
                throw dependencyUnavailableException;
            }
            if (exception instanceof RestClientException) {
                throw new DependencyUnavailableException();
            }
            throw new DependencyUnavailableException();
        }
    }

    private byte[] readBounded(InputStream body) {
        if (body == null) {
            throw new DependencyUnavailableException();
        }
        try {
            byte[] bytes = body.readNBytes(MAX_RESPONSE_BYTES + 1);
            if (bytes.length > MAX_RESPONSE_BYTES) {
                throw new DependencyUnavailableException();
            }
            return bytes;
        } catch (IOException exception) {
            throw new DependencyUnavailableException();
        }
    }

    private JsonNode parseObject(byte[] body) {
        JsonNode parsed = parseObjectOrNull(body);
        if (parsed == null) {
            throw new DependencyUnavailableException();
        }
        return parsed;
    }

    private JsonNode parseObjectOrNull(byte[] body) {
        if (body == null || body.length == 0 || body.length > MAX_RESPONSE_BYTES) {
            return null;
        }
        try {
            JsonNode payload = objectMapper.reader()
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .with(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .readTree(body);
            return payload != null && payload.isObject() ? payload : null;
        } catch (RuntimeException exception) {
            return null;
        }
    }

    private String requiredText(JsonNode payload, String field) {
        JsonNode value = payload.get(field);
        if (value == null || !value.isTextual() || value.asText().isBlank()
                || value.asText().length() > MAX_TOKEN_LENGTH
                || value.asText().codePoints().anyMatch(Character::isISOControl)) {
            throw new DependencyUnavailableException();
        }
        return value.asText();
    }

    private long requiredPositiveLong(JsonNode payload, String field) {
        JsonNode value = payload.get(field);
        if (value == null || !value.isIntegralNumber() || !value.canConvertToLong()) {
            throw new DependencyUnavailableException();
        }
        long result = value.longValue();
        if (result <= 0 || result > 24 * 60 * 60) {
            throw new DependencyUnavailableException();
        }
        return result;
    }

    private List<String> parseScopes(String scopeValue) {
        if (scopeValue == null || scopeValue.isBlank() || scopeValue.length() > 16 * 1024
                || scopeValue.codePoints().anyMatch(Character::isISOControl)) {
            throw new InvalidGoogleResponseException();
        }
        String normalized = scopeValue.replaceAll("\\s+\\[[^]]{1,128}]$", "").trim();
        if (normalized.isEmpty()) {
            throw new InvalidGoogleResponseException();
        }
        String[] values = normalized.split("\\s+");
        if (values.length > MAX_SCOPE_COUNT) {
            throw new InvalidGoogleResponseException();
        }
        List<String> scopes = new ArrayList<>(values.length);
        Set<String> unique = new HashSet<>();
        for (String value : values) {
            if (value.isBlank() || value.length() > MAX_SCOPE_LENGTH
                    || !unique.add(value)) {
                throw new InvalidGoogleResponseException();
            }
            scopes.add(value);
        }
        return List.copyOf(scopes);
    }

    private String encodeForm(Map<String, String> fields) {
        StringBuilder body = new StringBuilder();
        fields.forEach((key, value) -> {
            if (body.length() > 0) {
                body.append('&');
            }
            body.append(encode(key)).append('=').append(encode(value));
        });
        return body.toString();
    }

    private void appendQuery(StringBuilder url, String key, String value) {
        url.append(encode(key)).append('=').append(encode(value)).append('&');
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private void requireConfiguredClient() {
        if (!properties.isConfigured()) {
            throw new DependencyUnavailableException();
        }
    }

    private boolean isSuccess(int statusCode) {
        return statusCode >= 200 && statusCode < 300;
    }

    private boolean isValidAuthorizationCode(String code) {
        return code != null && !code.isBlank() && code.length() <= MAX_AUTHORIZATION_CODE_LENGTH
                && code.codePoints().noneMatch(Character::isISOControl);
    }

    private boolean isValidToken(String token) {
        return token != null && !token.isBlank() && token.length() <= MAX_TOKEN_LENGTH
                && token.codePoints().noneMatch(Character::isISOControl);
    }

    private boolean isSafeState(String state) {
        return state != null && state.length() == 43
                && state.codePoints().allMatch(value -> value >= 'A' && value <= 'Z'
                || value >= 'a' && value <= 'z'
                || value >= '0' && value <= '9'
                || value == '-' || value == '_');
    }

    private record HttpResponse(int statusCode, byte[] body) {
    }

    record Endpoints(URI authorization, URI token, URI gmailProfile, URI tokenInfo) {
        Endpoints {
            Objects.requireNonNull(authorization);
            Objects.requireNonNull(token);
            Objects.requireNonNull(gmailProfile);
            Objects.requireNonNull(tokenInfo);
        }
    }

    private static final class InvalidGoogleResponseException extends RuntimeException {
    }
}
