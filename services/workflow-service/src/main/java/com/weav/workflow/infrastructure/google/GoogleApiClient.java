package com.weav.workflow.infrastructure.google;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Bounded client for the fixed Google Calendar and Drive endpoints on www.googleapis.com. */
@Component
public class GoogleApiClient {

    private static final String BASE_URL = "https://www.googleapis.com";
    private static final int MAX_PATH_PARAMETER_LENGTH = 1024;
    private static final int MAX_ACCESS_TOKEN_LENGTH = 16 * 1024;
    private static final Set<String> ACCESS_TOKEN_FIELDS = Set.of("accessToken");
    private static final Set<String> RATE_LIMIT_REASONS = Set.of(
            "rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded");

    private final PinnedHttpTransport transport;

    public GoogleApiClient(PinnedHttpTransport transport) {
        this.transport = Objects.requireNonNull(transport, "transport must not be null");
    }

    /**
     * Sends one request and returns the JSON object response.
     *
     * @param provider the Workspace provider the connection must belong to
     * @param service  human-readable service name used in failure messages
     * @param path     path below {@code https://www.googleapis.com}, already percent-encoded
     */
    public Map<String, Object> call(
            ResolvedConnection connection,
            String provider,
            String service,
            String method,
            String path,
            Map<String, String> query,
            Object body) {
        return call(connection, provider, service, method, path, query, body, 0);
    }

    /** Same, but a Drive upload POST may send up to {@code uploadMaxRequestBytes} (0 keeps the default cap). */
    public Map<String, Object> call(
            ResolvedConnection connection,
            String provider,
            String service,
            String method,
            String path,
            Map<String, String> query,
            Object body,
            int uploadMaxRequestBytes) {
        String accessToken = accessToken(connection, provider, service);
        URI target;
        try {
            target = URI.create(BASE_URL + path);
        } catch (IllegalArgumentException exception) {
            throw configurationFailure(service);
        }
        PinnedHttpTransport.HttpResponse response = uploadMaxRequestBytes > 0
                ? transport.executeGoogleApiWithBearerToken(target, method, query, body, accessToken, uploadMaxRequestBytes)
                : transport.executeGoogleApiWithBearerToken(target, method, query, body, accessToken);
        return successfulObject(response, service);
    }

    /** Percent-encodes one path segment (UTF-8, space as %20). */
    public static String encodePathSegment(String value, String service) {
        if (value == null || value.isBlank() || value.length() > MAX_PATH_PARAMETER_LENGTH
                || value.equals(".") || value.equals("..")
                || value.codePoints().anyMatch(codePoint -> Character.isISOControl(codePoint)
                || codePoint >= 0xd800 && codePoint <= 0xdfff)) {
            throw configurationFailure(service);
        }
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private static String accessToken(ResolvedConnection connection, String provider, String service) {
        try {
            if (connection == null
                    || !provider.equals(connection.provider())
                    || !"OAUTH2".equals(connection.authType())) {
                throw connectionConfigurationFailure(service);
            }
            Map<String, String> auth = connection.auth();
            if (!auth.keySet().equals(ACCESS_TOKEN_FIELDS)) {
                throw connectionConfigurationFailure(service);
            }
            String token = auth.get("accessToken");
            if (token == null || token.isBlank() || token.length() > MAX_ACCESS_TOKEN_LENGTH
                    || token.codePoints().anyMatch(Character::isISOControl)) {
                throw connectionConfigurationFailure(service);
            }
            return token;
        } catch (NodeExecutor.Failure failure) {
            throw failure;
        } catch (RuntimeException exception) {
            throw connectionConfigurationFailure(service);
        }
    }

    private static Map<String, Object> successfulObject(PinnedHttpTransport.HttpResponse response, String service) {
        if (response == null) {
            throw invalidResponse(service);
        }
        int status = response.status();
        if (status >= 200 && status < 300) {
            if (!(response.data() instanceof Map<?, ?> map)) {
                throw invalidResponse(service);
            }
            Map<String, Object> result = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!(entry.getKey() instanceof String key)) {
                    throw invalidResponse(service);
                }
                result.put(key, entry.getValue());
            }
            return result;
        }
        if (status == 401) {
            throw new NodeExecutor.Failure("AUTHENTICATION_REJECTED",
                    "The " + service + " provider rejected the configured credentials. "
                            + "Reconnect the connection and run again.", false);
        }
        if (status == 429 || status == 403 && isRateLimit(response.data())) {
            throw new NodeExecutor.Failure("HTTP_RATE_LIMITED",
                    "The " + service + " provider rate limited the request.", true, true);
        }
        if (status == 403) {
            throw new NodeExecutor.Failure("HTTP_BUSINESS_REJECTED",
                    "The " + service + " provider denied access. The connection may lack the required "
                            + "permission; reconnect it and approve all requested access.", false);
        }
        if (status == 404) {
            throw new NodeExecutor.Failure("HTTP_BUSINESS_REJECTED",
                    "The requested " + service + " resource was not found. With the limited Drive permission, "
                            + "only files and folders created or opened by Weav are visible.", false);
        }
        if (status == 408 || status >= 500) {
            throw new NodeExecutor.Failure("HTTP_DEPENDENCY_UNAVAILABLE",
                    "The " + service + " provider is temporarily unavailable.", true);
        }
        if (status >= 300 && status < 400) {
            throw new NodeExecutor.Failure("HTTP_REDIRECT_REJECTED",
                    "The " + service + " provider returned a redirect that is not followed.", false);
        }
        if (status >= 400 && status < 500) {
            throw new NodeExecutor.Failure("HTTP_BUSINESS_REJECTED",
                    "The " + service + " provider rejected the request.", false);
        }
        throw invalidResponse(service);
    }

    /** Google reports some quota errors as 403 with {@code error.errors[].reason}. */
    private static boolean isRateLimit(Object data) {
        if (data instanceof Map<?, ?> root && root.get("error") instanceof Map<?, ?> error
                && error.get("errors") instanceof List<?> errors) {
            return errors.stream().anyMatch(item -> item instanceof Map<?, ?> entry
                    && entry.get("reason") instanceof String reason && RATE_LIMIT_REASONS.contains(reason));
        }
        return false;
    }

    private static NodeExecutor.Failure invalidResponse(String service) {
        return new NodeExecutor.Failure("HTTP_INVALID_RESPONSE",
                "The " + service + " provider returned an invalid response.", true);
    }

    static NodeExecutor.Failure configurationFailure(String service) {
        return new NodeExecutor.Failure("CONFIGURATION_ERROR",
                "The " + service + " node configuration is invalid.", false);
    }

    private static NodeExecutor.Failure connectionConfigurationFailure(String service) {
        return new NodeExecutor.Failure("CONNECTION_CONFIGURATION_INVALID",
                "The " + service + " connection configuration is invalid.", false);
    }
}
