package com.weav.workspace.application.service;

import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.application.dto.GoogleOAuthTokenResponse;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Validates and serializes the manual credential shapes supported in V1.
 *
 * <p>This class intentionally accepts an opaque map at the application
 * boundary and returns only serialized bytes. It never logs, returns, or
 * includes a credential value in a validation error.</p>
 */
public final class CredentialPayloadCodec {

    private static final Set<String> TOKEN_FIELDS = Set.of("token");
    private static final Set<String> API_KEY_FIELDS = Set.of("apiKey");
    private static final Set<String> BASIC_FIELDS = Set.of("username", "password");
    private static final Set<String> OAUTH_FIELDS = Set.of(
            "accessToken", "refreshToken", "tokenType", "grantedScopes");
    private static final TypeReference<Map<String, Object>> PAYLOAD_TYPE = new TypeReference<>() {
    };
    private static final int MAX_PAYLOAD_BYTES = 16 * 1024;
    private static final int MAX_OAUTH_PAYLOAD_BYTES = 48 * 1024;
    private static final int MAX_OAUTH_TOKEN_LENGTH = 16 * 1024;
    private static final int MAX_OAUTH_SCOPE_COUNT = 64;
    private static final int MAX_OAUTH_SCOPE_LENGTH = 1024;

    private final ObjectMapper objectMapper;
    private final ConnectionProviderPolicy providerPolicy;

    public CredentialPayloadCodec(ObjectMapper objectMapper, ConnectionProviderPolicy providerPolicy) {
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.providerPolicy = Objects.requireNonNull(providerPolicy, "providerPolicy must not be null");
    }

    public CredentialPayloadCodec(ObjectMapper objectMapper) {
        this(objectMapper, new ConnectionProviderPolicy());
    }

    public byte[] encode(Connection connection, Map<String, Object> payload) {
        Objects.requireNonNull(connection, "connection must not be null");
        return encode(connection.getProvider(), connection.getAuthType(), payload);
    }

    public byte[] encode(
            ConnectionProvider provider,
            ConnectionAuthType authType,
            Map<String, Object> payload) {
        validateShape(provider, authType, payload);
        try {
            byte[] encoded = objectMapper.writeValueAsBytes(payload);
            if (encoded.length > MAX_PAYLOAD_BYTES) {
                throw invalidPayload();
            }
            return encoded;
        } catch (RuntimeException exception) {
            if (exception instanceof BadRequestException badRequestException) {
                throw badRequestException;
            }
            throw invalidPayload();
        }
    }

    /** Serializes only the server-produced Google OAuth credential shape. */
    public byte[] encodeGoogleOAuth(Connection connection, GoogleOAuthTokenResponse tokens) {
        Objects.requireNonNull(connection, "connection must not be null");
        Objects.requireNonNull(tokens, "tokens must not be null");
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("accessToken", tokens.accessToken());
        payload.put("refreshToken", tokens.refreshToken());
        payload.put("tokenType", tokens.tokenType());
        payload.put("grantedScopes", tokens.grantedScopes());
        validateGoogleOAuthShape(connection.getProvider(), connection.getAuthType(), payload);
        return encodePayload(payload, MAX_OAUTH_PAYLOAD_BYTES);
    }

    /**
     * Strictly decodes an already decrypted payload and reuses the exact
     * provider/auth shape checks used by manual credential writes.
     *
     * <p>The returned map is detached from Jackson's mutable representation,
     * and all parse/shape failures use one secret-free error.</p>
     */
    public Map<String, Object> decode(Connection connection, byte[] plaintext) {
        Objects.requireNonNull(connection, "connection must not be null");
        boolean googleOAuth = isGoogleOAuth(connection.getProvider(), connection.getAuthType());
        int maxPayloadBytes = googleOAuth ? MAX_OAUTH_PAYLOAD_BYTES : MAX_PAYLOAD_BYTES;
        if (plaintext == null || plaintext.length == 0 || plaintext.length > maxPayloadBytes) {
            throw invalidPayload();
        }
        try {
            Map<String, Object> payload = objectMapper
                    .readerFor(PAYLOAD_TYPE)
                    .with(tools.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .with(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .readValue(plaintext);
            if (payload == null) {
                throw invalidPayload();
            }
            Map<String, Object> detachedPayload = new LinkedHashMap<>(payload);
            if (googleOAuth) {
                validateGoogleOAuthShape(connection.getProvider(), connection.getAuthType(), detachedPayload);
                detachedPayload.put("grantedScopes", List.copyOf((List<?>) detachedPayload.get("grantedScopes")));
            } else {
                validateShape(connection.getProvider(), connection.getAuthType(), detachedPayload);
            }
            return Map.copyOf(detachedPayload);
        } catch (BadRequestException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw invalidPayload();
        }
    }

    private void validateShape(
            ConnectionProvider provider,
            ConnectionAuthType authType,
            Map<String, Object> payload) {
        if (provider == null || authType == null || payload == null) {
            throw invalidPayload();
        }

        try {
            providerPolicy.validate(provider, authType);
        } catch (RuntimeException exception) {
            throw invalidPayload();
        }

        Set<String> expectedFields = switch (provider) {
            case TELEGRAM -> authType == ConnectionAuthType.TOKEN ? TOKEN_FIELDS : null;
            case HTTP -> switch (authType) {
                case TOKEN -> TOKEN_FIELDS;
                case API_KEY -> API_KEY_FIELDS;
                case BASIC -> BASIC_FIELDS;
                case NONE, OAUTH2 -> null;
            };
            case GMAIL, GOOGLE_SHEETS -> null;
        };

        if (expectedFields == null
                || payload.size() != expectedFields.size()
                || !payload.keySet().equals(expectedFields)
                || payload.values().stream().anyMatch(value -> !(value instanceof String text) || text.isBlank())) {
            throw invalidPayload();
        }
    }

    private void validateGoogleOAuthShape(
            ConnectionProvider provider,
            ConnectionAuthType authType,
            Map<String, Object> payload) {
        if (!isGoogleOAuth(provider, authType) || payload == null
                || payload.size() != OAUTH_FIELDS.size()
                || !payload.keySet().equals(OAUTH_FIELDS)
                || !isValidToken(payload.get("accessToken"))
                || !isValidToken(payload.get("refreshToken"))
                || !(payload.get("tokenType") instanceof String tokenType)
                || !"Bearer".equals(tokenType)
                || !(payload.get("grantedScopes") instanceof List<?> scopes)
                || scopes.isEmpty()
                || scopes.size() > MAX_OAUTH_SCOPE_COUNT) {
            throw invalidPayload();
        }
        java.util.HashSet<String> uniqueScopes = new java.util.HashSet<>();
        for (Object scope : scopes) {
            if (!(scope instanceof String value)
                    || value.isBlank()
                    || value.length() > MAX_OAUTH_SCOPE_LENGTH
                    || value.codePoints().anyMatch(Character::isISOControl)
                    || !uniqueScopes.add(value)) {
                throw invalidPayload();
            }
        }
        try {
            providerPolicy.validate(provider, authType);
        } catch (RuntimeException exception) {
            throw invalidPayload();
        }
    }

    private boolean isGoogleOAuth(ConnectionProvider provider, ConnectionAuthType authType) {
        return authType == ConnectionAuthType.OAUTH2
                && (provider == ConnectionProvider.GMAIL || provider == ConnectionProvider.GOOGLE_SHEETS);
    }

    private boolean isValidToken(Object value) {
        return value instanceof String text
                && !text.isBlank()
                && text.length() <= MAX_OAUTH_TOKEN_LENGTH
                && text.codePoints().noneMatch(Character::isISOControl);
    }

    private byte[] encodePayload(Map<String, Object> payload, int maxBytes) {
        try {
            byte[] encoded = objectMapper.writeValueAsBytes(payload);
            if (encoded.length > maxBytes) {
                throw invalidPayload();
            }
            return encoded;
        } catch (RuntimeException exception) {
            if (exception instanceof BadRequestException badRequestException) {
                throw badRequestException;
            }
            throw invalidPayload();
        }
    }

    private BadRequestException invalidPayload() {
        return new BadRequestException("Credential payload is invalid");
    }
}
