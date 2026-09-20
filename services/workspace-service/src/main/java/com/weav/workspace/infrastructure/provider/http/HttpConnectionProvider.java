package com.weav.workspace.infrastructure.provider.http;

import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.port.out.ConnectionProviderPort;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * V1 provider for a bounded, header-authenticated HTTP health check.
 */
public final class HttpConnectionProvider implements ConnectionProviderPort {

    private static final String BASE_URL = "baseUrl";
    private static final String TEST_PATH = "testPath";
    private static final String API_KEY_HEADER_NAME = "apiKeyHeaderName";
    private static final int MAX_CREDENTIAL_VALUE_LENGTH = 4096;
    private static final Pattern HEADER_NAME = Pattern.compile("^[!#$%&'*+.^_`|~0-9A-Za-z-]+$");
    private static final Set<String> FORBIDDEN_HEADER_NAMES = Set.of(
            "authorization",
            "proxy-authorization",
            "cookie",
            "set-cookie",
            "host",
            "connection",
            "content-length",
            "transfer-encoding");

    private final HttpTargetValidator targetValidator;
    private final PinnedHttpTransport transport;

    public HttpConnectionProvider() {
        this(new HttpTargetValidator(), new PinnedHttpTransport());
    }

    public HttpConnectionProvider(
            HttpTargetValidator targetValidator,
            PinnedHttpTransport transport) {
        this.targetValidator = Objects.requireNonNull(
                targetValidator, "targetValidator must not be null");
        this.transport = Objects.requireNonNull(transport, "transport must not be null");
    }

    @Override
    public ConnectionProvider provider() {
        return ConnectionProvider.HTTP;
    }

    @Override
    public void validateConfig(ConnectionAuthType authType, Map<String, Object> config) {
        if (authType == null) {
            throw invalidConfig();
        }
        if (authType == ConnectionAuthType.OAUTH2) {
            throw invalidConfig();
        }
        Map<String, Object> safeConfig = config == null ? Map.of() : config;
        URI baseUrl = requireBaseUrl(safeConfig);
        targetValidator.validateUriShape(baseUrl);
        if (baseUrl.getRawQuery() != null) {
            throw invalidConfig();
        }
        rejectPathTraversal(baseUrl.getRawPath());

        Object testPath = safeConfig.get(TEST_PATH);
        if (testPath != null) {
            validateTestPath(testPath);
        }

        if (authType == ConnectionAuthType.API_KEY) {
            validateApiKeyHeaderName(safeConfig.get(API_KEY_HEADER_NAME));
        }
    }

    @Override
    public ConnectionTestResult test(
            Connection connection,
            Map<String, Object> decryptedCredential) {
        Objects.requireNonNull(connection, "connection must not be null");
        if (connection.getProvider() != ConnectionProvider.HTTP) {
            throw invalidConfig();
        }
        validateConfig(connection.getAuthType(), connection.getConfig());

        Map<String, Object> config = connection.getConfig();
        final Map<String, String> headers;
        try {
            headers = authenticationHeaders(
                    connection.getAuthType(), config, decryptedCredential);
        } catch (InvalidCredentialException exception) {
            return ConnectionTestResult.authInvalid();
        }
        String rawTestPath = optionalText(config.get(TEST_PATH));
        if (rawTestPath == null) {
            // A connection without a health-check path has a fully validated
            // shape, but there is no safe endpoint to call in V1.
            return ConnectionTestResult.verified();
        }

        URI target = resolveTarget(requireBaseUrl(config), rawTestPath);
        try {
            HttpTargetValidator.ValidatedTarget validated = targetValidator.validateAndResolve(target);
            PinnedHttpTransport.Response response = transport.get(validated, headers);
            return classify(response.statusCode());
        } catch (DependencyUnavailableException exception) {
            return ConnectionTestResult.dependencyFailure();
        }
    }

    private Map<String, String> authenticationHeaders(
            ConnectionAuthType authType,
            Map<String, Object> config,
            Map<String, Object> credential) {
        if (authType == ConnectionAuthType.NONE) {
            return Map.of();
        }
        if (credential == null) {
            throw new InvalidCredentialException();
        }
        return switch (authType) {
            case TOKEN -> {
                String token = credentialText(credential, "token");
                yield Map.of("Authorization", "Bearer " + token);
            }
            case BASIC -> {
                String username = credentialText(credential, "username");
                String password = credentialText(credential, "password");
                String raw = username + ":" + password;
                yield Map.of("Authorization", "Basic " + Base64.getEncoder().encodeToString(
                        raw.getBytes(StandardCharsets.UTF_8)));
            }
            case API_KEY -> {
                String headerName = requireHeaderName(config.get(API_KEY_HEADER_NAME));
                String value = credentialText(credential, "apiKey");
                yield Map.of(headerName, value);
            }
            case NONE, OAUTH2 -> throw invalidConfig();
        };
    }

    private String credentialText(Map<String, Object> credential, String field) {
        if (credential.size() != expectedCredentialSize(field)
                || !(credential.get(field) instanceof String value)
                || value.isBlank()
                || value.length() > MAX_CREDENTIAL_VALUE_LENGTH
                || value.codePoints().anyMatch(Character::isISOControl)) {
            throw new InvalidCredentialException();
        }
        return value;
    }

    private int expectedCredentialSize(String field) {
        return field.equals("username") || field.equals("password") ? 2 : 1;
    }

    private URI requireBaseUrl(Map<String, Object> config) {
        if (!(config.get(BASE_URL) instanceof String value) || value.isBlank()) {
            throw invalidConfig();
        }
        try {
            return URI.create(value.trim());
        } catch (IllegalArgumentException exception) {
            throw invalidConfig();
        }
    }

    private void validateTestPath(Object value) {
        if (!(value instanceof String path) || path.isBlank()) {
            throw invalidConfig();
        }
        if (path.indexOf('\r') >= 0 || path.indexOf('\n') >= 0 || !path.startsWith("/")) {
            throw invalidConfig();
        }
        try {
            URI uri = URI.create(path);
            if (uri.isAbsolute()
                    || uri.getRawAuthority() != null
                    || uri.getRawUserInfo() != null
                    || uri.getRawFragment() != null
                    || hasPathTraversal(uri.getRawPath())) {
                throw invalidConfig();
            }
        } catch (IllegalArgumentException exception) {
            throw invalidConfig();
        }
    }

    private URI resolveTarget(URI baseUrl, String testPath) {
        try {
            URI path = URI.create(testPath);
            validateTestPath(path.toString());
            String authority = baseUrl.getRawAuthority();
            if (authority == null) {
                throw invalidConfig();
            }
            String joinedPath = joinPaths(baseUrl.getRawPath(), path.getRawPath());
            StringBuilder rawTarget = new StringBuilder()
                    .append(baseUrl.getScheme())
                    .append("://")
                    .append(authority)
                    .append(joinedPath);
            if (path.getRawQuery() != null) {
                rawTarget.append('?').append(path.getRawQuery());
            }
            URI target = URI.create(rawTarget.toString());
            targetValidator.validateUriShape(target);
            return target;
        } catch (IllegalArgumentException exception) {
            throw invalidConfig();
        }
    }

    private String joinPaths(String basePath, String testPath) {
        if (testPath == null || !testPath.startsWith("/")) {
            throw invalidConfig();
        }
        if (basePath == null || basePath.isEmpty() || "/".equals(basePath)) {
            return testPath;
        }
        if (basePath.endsWith("/")) {
            return basePath.substring(0, basePath.length() - 1) + testPath;
        }
        return basePath + testPath;
    }

    private void rejectPathTraversal(String rawPath) {
        if (hasPathTraversal(rawPath)) {
            throw invalidConfig();
        }
    }

    private boolean hasPathTraversal(String rawPath) {
        if (rawPath == null) {
            return false;
        }
        String candidate = rawPath;
        for (int round = 0; round < 3; round++) {
            if (candidate.indexOf('\\') >= 0) {
                return true;
            }
            for (String segment : candidate.split("/", -1)) {
                if (".".equals(segment) || "..".equals(segment)) {
                    return true;
                }
            }
            String decoded = decodePercentAscii(candidate);
            if (decoded.equals(candidate)) {
                break;
            }
            candidate = decoded;
        }
        return false;
    }

    private String decodePercentAscii(String value) {
        StringBuilder decoded = new StringBuilder(value.length());
        for (int index = 0; index < value.length(); index++) {
            char current = value.charAt(index);
            if (current == '%' && index + 2 < value.length()) {
                int high = Character.digit(value.charAt(index + 1), 16);
                int low = Character.digit(value.charAt(index + 2), 16);
                if (high >= 0 && low >= 0) {
                    decoded.append((char) ((high << 4) | low));
                    index += 2;
                    continue;
                }
            }
            decoded.append(current);
        }
        return decoded.toString();
    }

    private void validateApiKeyHeaderName(Object value) {
        requireHeaderName(value);
    }

    private String requireHeaderName(Object value) {
        if (!(value instanceof String name)
                || name.isBlank()
                || name.length() > 128
                || !HEADER_NAME.matcher(name).matches()
                || FORBIDDEN_HEADER_NAMES.contains(name.toLowerCase(java.util.Locale.ROOT))) {
            throw invalidConfig();
        }
        return name;
    }

    private String optionalText(Object value) {
        if (value == null) {
            return null;
        }
        if (!(value instanceof String text) || text.isBlank()) {
            throw invalidConfig();
        }
        validateTestPath(text);
        return text;
    }

    private ConnectionTestResult classify(int statusCode) {
        if (statusCode >= 200 && statusCode < 300) {
            return ConnectionTestResult.verified();
        }
        if (statusCode == 408 || statusCode == 429 || statusCode >= 500) {
            return ConnectionTestResult.dependencyFailure();
        }
        if (statusCode == 401 || statusCode == 403) {
            return ConnectionTestResult.authInvalid();
        }
        // Redirects are disabled by the transport. Any other non-success
        // response is not confirmation that credentials were rejected. It may
        // be a missing path, unsupported method, or malformed request.
        return ConnectionTestResult.dependencyFailure();
    }

    private BadRequestException invalidConfig() {
        return new BadRequestException("HTTP connection configuration is invalid");
    }

    private static final class InvalidCredentialException extends RuntimeException {
    }
}
