package com.weav.workspace.infrastructure.provider.telegram;

import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.port.out.ConnectionProviderPort;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.infrastructure.provider.http.HttpTargetValidator;
import com.weav.workspace.infrastructure.provider.http.PinnedHttpTransport;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Telegram TOKEN verification through the Bot API getMe endpoint.
 */
public final class TelegramConnectionProvider implements ConnectionProviderPort {

    private static final URI TELEGRAM_API = URI.create("https://api.telegram.org/");
    private static final int MAX_TOKEN_LENGTH = 4096;
    private static final Set<Integer> BAD_TOKEN_ERROR_CODES = Set.of(401, 404);

    private final URI apiBaseUrl;
    private final HttpTargetValidator targetValidator;
    private final PinnedHttpTransport transport;
    private final ObjectMapper objectMapper;

    public TelegramConnectionProvider() {
        this(TELEGRAM_API, new HttpTargetValidator(), new PinnedHttpTransport(), new ObjectMapper());
    }

    public TelegramConnectionProvider(
            URI apiBaseUrl,
            HttpTargetValidator targetValidator,
            PinnedHttpTransport transport,
            ObjectMapper objectMapper) {
        this.apiBaseUrl = Objects.requireNonNull(apiBaseUrl, "apiBaseUrl must not be null");
        this.targetValidator = Objects.requireNonNull(
                targetValidator, "targetValidator must not be null");
        this.transport = Objects.requireNonNull(transport, "transport must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        targetValidator.validateUriShape(apiBaseUrl);
        if (apiBaseUrl.getRawQuery() != null || apiBaseUrl.getRawFragment() != null) {
            throw new IllegalArgumentException("Telegram API base URL must not contain query or fragment");
        }
    }

    @Override
    public ConnectionProvider provider() {
        return ConnectionProvider.TELEGRAM;
    }

    @Override
    public void validateConfig(ConnectionAuthType authType, Map<String, Object> config) {
        if (authType != ConnectionAuthType.TOKEN
                || (config != null && !config.isEmpty())) {
            throw new BadRequestException("Telegram connection configuration is invalid");
        }
    }

    @Override
    public ConnectionTestResult test(
            Connection connection,
            Map<String, Object> decryptedCredential) {
        Objects.requireNonNull(connection, "connection must not be null");
        if (connection.getProvider() != ConnectionProvider.TELEGRAM) {
            throw new BadRequestException("Telegram connection configuration is invalid");
        }
        validateConfig(connection.getAuthType(), connection.getConfig());
        if (decryptedCredential == null
                || decryptedCredential.size() != 1
                || !(decryptedCredential.get("token") instanceof String token)
                || token.isBlank()
                || token.length() > MAX_TOKEN_LENGTH
                || token.codePoints().anyMatch(Character::isISOControl)) {
            return ConnectionTestResult.authInvalid();
        }

        URI target = endpoint(token);
        try {
            HttpTargetValidator.ValidatedTarget validated = targetValidator.validateAndResolve(target);
            PinnedHttpTransport.Response response = transport.get(validated, Map.of());
            return classify(response.statusCode(), response.body());
        } catch (DependencyUnavailableException exception) {
            return ConnectionTestResult.dependencyFailure();
        }
    }

    private URI endpoint(String token) {
        String encodedToken = URLEncoder.encode(token, StandardCharsets.UTF_8)
                .replace("+", "%20");
        String base = apiBaseUrl.toString();
        if (!base.endsWith("/")) {
            base += "/";
        }
        try {
            return URI.create(base + "bot" + encodedToken + "/getMe");
        } catch (IllegalArgumentException exception) {
            // The token is never included in this exception or its cause.
            throw new BadRequestException("Telegram credential is invalid");
        }
    }

    private ConnectionTestResult classify(int statusCode, byte[] body) {
        if (statusCode == 401 || statusCode == 404) {
            return ConnectionTestResult.authInvalid();
        }
        if (statusCode == 408 || statusCode == 429 || statusCode >= 500) {
            return ConnectionTestResult.dependencyFailure();
        }
        if (statusCode < 200 || statusCode >= 300) {
            return isBadTokenResponse(body)
                    ? ConnectionTestResult.authInvalid()
                    : ConnectionTestResult.dependencyFailure();
        }
        JsonNode payload = parsePayload(body);
        JsonNode ok = payload == null ? null : payload.get("ok");
        if (ok == null || !ok.isBoolean()) {
            return ConnectionTestResult.dependencyFailure();
        }
        if (ok.booleanValue()) {
            return ConnectionTestResult.verified();
        }
        return isBadTokenPayload(payload)
                ? ConnectionTestResult.authInvalid()
                : ConnectionTestResult.dependencyFailure();
    }

    private boolean isBadTokenResponse(byte[] body) {
        JsonNode payload = parsePayload(body);
        return isBadTokenPayload(payload);
    }

    private boolean isBadTokenPayload(JsonNode payload) {
        if (payload == null || !payload.isObject()) {
            return false;
        }
        JsonNode ok = payload.get("ok");
        JsonNode errorCode = payload.get("error_code");
        return ok != null
                && ok.isBoolean()
                && !ok.booleanValue()
                && errorCode != null
                && errorCode.isIntegralNumber()
                && errorCode.canConvertToInt()
                && BAD_TOKEN_ERROR_CODES.contains(errorCode.intValue());
    }

    private JsonNode parsePayload(byte[] body) {
        try {
            return objectMapper.reader()
                    .with(tools.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .with(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .readTree(body);
        } catch (RuntimeException exception) {
            return null;
        }
    }
}
