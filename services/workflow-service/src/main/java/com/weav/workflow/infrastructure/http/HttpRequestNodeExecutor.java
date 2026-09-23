package com.weav.workflow.infrastructure.http;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.domain.exception.ForbiddenException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/** Executes the published {@code http.request} node through the bounded HTTP adapter. */
@Component
@ConditionalOnProperty(
        prefix = "weav.workflow.http.executor",
        name = "enabled",
        havingValue = "true",
        matchIfMissing = true)
public final class HttpRequestNodeExecutor implements NodeExecutor {

    private static final String TYPE = "http.request";
    private static final Set<String> METHODS = Set.of(
            "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS");
    private static final Pattern HEADER_NAME = Pattern.compile("^[!#$%&'*+.^_`|~0-9A-Za-z-]+$");
    private static final Set<String> INLINE_CREDENTIAL_HEADERS = Set.of(
            "authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "api-key");

    private final OutboundTargetPolicy targetPolicy;
    private final PinnedHttpTransport transport;
    private final WorkspaceConnectionPort workspaceConnections;

    public HttpRequestNodeExecutor(
            OutboundTargetPolicy targetPolicy,
            PinnedHttpTransport transport,
            WorkspaceConnectionPort workspaceConnections) {
        this.targetPolicy = Objects.requireNonNull(targetPolicy, "targetPolicy must not be null");
        this.transport = Objects.requireNonNull(transport, "transport must not be null");
        this.workspaceConnections = Objects.requireNonNull(
                workspaceConnections, "workspaceConnections must not be null");
    }

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    public Result execute(Context context, Map<String, Object> resolvedConfig) {
        Objects.requireNonNull(context, "context must not be null");
        Request request = parseRequest(resolvedConfig);

        // Approve and pin the target before resolving any secret. This keeps a
        // blocked destination from causing an unnecessary credential fetch.
        OutboundTargetPolicy.ApprovedTarget target = targetPolicy.approve(request.uri());

        ResolvedConnection connection = null;
        Set<String> activeSecrets = Set.of();
        try {
            Map<String, String> authHeaders = Map.of();
            if (request.connectionId() != null) {
                try {
                    connection = workspaceConnections.resolve(context.workspaceId(), request.connectionId());
                    if (connection == null) {
                        throw new Failure("CONNECTION_UNAVAILABLE",
                                "The connection service returned no connection.", true);
                    }
                    Authentication authentication = authentication(connection);
                    authHeaders = authentication.headers();
                    activeSecrets = authentication.secrets();
                } catch (ForbiddenException exception) {
                    throw new Failure("CONNECTION_FORBIDDEN",
                            "The HTTP connection is not available to this workspace.", false);
                } catch (WorkspaceDependencyUnavailableException exception) {
                    throw new Failure("CONNECTION_UNAVAILABLE",
                            "The connection service is unavailable.", true);
                } catch (Failure failure) {
                    throw failure;
                } catch (RuntimeException exception) {
                    throw new Failure("CONNECTION_UNAVAILABLE",
                            "The connection service is unavailable.", true);
                }
            }

            PinnedHttpTransport.HttpResponse response = transport.executeWithAuthentication(
                    target, request.method(), request.headers(), authHeaders, request.query(), request.body());
            if (connection != null) {
                connection.close();
                connection = null;
            }
            return classify(context, request.connectionId(), response, activeSecrets);
        } finally {
            if (connection != null) {
                connection.close();
            }
        }
    }

    private Result classify(
            Context context,
            UUID connectionId,
            PinnedHttpTransport.HttpResponse response,
            Set<String> activeSecrets) {
        int status = response.status();
        if (status >= 200 && status < 300) {
            return successfulResult(status, response.data(), activeSecrets);
        }
        if (status == 401) {
            if (connectionId != null) {
                try {
                    workspaceConnections.reportAuthenticationRejected(context.workspaceId(), connectionId);
                } catch (RuntimeException ignored) {
                    // The provider already confirmed the rejection. A failure
                    // to record it must not expose a downstream body or change
                    // the stable node classification.
                }
            }
            throw new Failure("AUTHENTICATION_REJECTED",
                    "The HTTP provider rejected the configured credentials.", false);
        }
        if (status == 429) {
            throw new Failure("HTTP_RATE_LIMITED",
                    "The HTTP provider rate limited the request.", true);
        }
        if (status == 408 || status >= 500) {
            throw new Failure("HTTP_DEPENDENCY_UNAVAILABLE",
                    "The HTTP provider is temporarily unavailable.", true);
        }
        if (status >= 300 && status < 400) {
            throw new Failure("HTTP_REDIRECT_REJECTED",
                    "The HTTP provider returned a redirect that is not followed.", false);
        }
        if (status >= 400 && status < 500) {
            throw new Failure("HTTP_BUSINESS_REJECTED",
                    "The HTTP provider rejected the request.", false);
        }
        throw new Failure("HTTP_DEPENDENCY_UNAVAILABLE",
                "The HTTP provider returned an invalid response.", true);
    }

    private Result successfulResult(int status, Object data, Set<String> activeSecrets) {
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("status", status);
        output.put("data", OutputSanitizer.sanitize(data, activeSecrets));
        return new Result(output, null);
    }

    private Authentication authentication(ResolvedConnection connection) {
        String provider = upper(connection.provider());
        String authType = upper(connection.authType());
        if (!"HTTP".equals(provider)) {
            throw new Failure("CONNECTION_CONFIGURATION_INVALID",
                    "The connection provider is not supported by this node.", false);
        }

        Map<String, String> auth = connection.auth();
        Set<String> secrets = new LinkedHashSet<>(auth.values());
        return switch (authType) {
            case "NONE" -> {
                requireKeys(auth, Set.of());
                yield new Authentication(Map.of(), Set.of());
            }
            case "TOKEN" -> {
                requireKeys(auth, Set.of("token"));
                String token = requiredSecret(auth, "token");
                yield withHeaderSecrets(Map.of("Authorization", "Bearer " + token), secrets);
            }
            case "BASIC" -> {
                requireKeys(auth, Set.of("username", "password"));
                String username = requiredSecret(auth, "username");
                String password = requiredSecret(auth, "password");
                String encoded = Base64.getEncoder().encodeToString(
                        (username + ":" + password).getBytes(StandardCharsets.UTF_8));
                yield withHeaderSecrets(Map.of("Authorization", "Basic " + encoded), secrets);
            }
            case "API_KEY" -> {
                throw new Failure("DEPENDENCY_NOT_CONFIGURED",
                        "Workspace has not provided the configured API key header name.", false);
            }
            default -> throw new Failure("CONNECTION_CONFIGURATION_INVALID",
                    "The connection authentication mode is not supported by this node.", false);
        };
    }

    private Authentication withHeaderSecrets(Map<String, String> headers, Set<String> secretValues) {
        Set<String> allSecrets = new LinkedHashSet<>(secretValues);
        allSecrets.addAll(headers.values());
        return new Authentication(Map.copyOf(headers), Set.copyOf(allSecrets));
    }

    private void requireKeys(Map<String, String> actual, Set<String> expected) {
        if (!actual.keySet().equals(expected)) {
            throw new Failure("CONNECTION_CONFIGURATION_INVALID",
                    "The connection authentication configuration is invalid.", false);
        }
    }

    private String requiredSecret(Map<String, String> auth, String key) {
        String value = auth.get(key);
        if (value == null || value.isBlank() || value.length() > 16 * 1024
                || value.codePoints().anyMatch(Character::isISOControl)) {
            throw new Failure("CONNECTION_CONFIGURATION_INVALID",
                    "The connection authentication configuration is invalid.", false);
        }
        return value;
    }

    private Request parseRequest(Map<String, Object> config) {
        if (config == null) {
            throw new Failure("CONFIGURATION_ERROR", "HTTP request configuration is missing.", false);
        }
        String method = requiredString(config.get("method"), "HTTP method").toUpperCase(Locale.ROOT);
        if (!METHODS.contains(method)) {
            throw new Failure("CONFIGURATION_ERROR", "The HTTP method is not supported.", false);
        }
        String rawUrl = requiredString(config.get("url"), "HTTP URL");
        URI uri;
        try {
            uri = URI.create(rawUrl);
        } catch (IllegalArgumentException exception) {
            throw new Failure("CONFIGURATION_ERROR", "The HTTP URL is invalid.", false);
        }

        Map<String, String> headers = parseHeaders(config.get("headers"));
        UUID connectionId = parseConnectionId(config.get("connectionId"));
        return new Request(method, uri, headers, config.get("query"), config.get("body"), connectionId);
    }

    private Map<String, String> parseHeaders(Object value) {
        if (value == null) {
            return Map.of();
        }
        if (!(value instanceof Map<?, ?> map)) {
            throw new Failure("CONFIGURATION_ERROR", "The HTTP headers are invalid.", false);
        }
        Map<String, String> headers = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            if (!(entry.getKey() instanceof String name) || !(entry.getValue() instanceof String headerValue)
                    || name.isBlank() || !HEADER_NAME.matcher(name).matches()
                    || headerValue.isBlank() || hasControl(headerValue)
                    || isInlineCredentialHeader(name)) {
                throw new Failure("CONFIGURATION_ERROR", "The HTTP headers are invalid.", false);
            }
            String normalized = name.toLowerCase(Locale.ROOT);
            if (headers.keySet().stream().anyMatch(existing -> existing.equalsIgnoreCase(name))) {
                throw new Failure("CONFIGURATION_ERROR", "The HTTP headers are invalid.", false);
            }
            if (normalized.equals("host") || normalized.equals("content-length")
                    || normalized.equals("transfer-encoding") || normalized.equals("connection")
                    || normalized.equals("proxy-connection") || normalized.equals("keep-alive")
                    || normalized.equals("te") || normalized.equals("trailer")
                    || normalized.equals("upgrade")) {
                throw new Failure("CONFIGURATION_ERROR", "The HTTP headers are invalid.", false);
            }
            headers.put(name, headerValue);
        }
        return Map.copyOf(headers);
    }

    private boolean isInlineCredentialHeader(String name) {
        String normalized = name.toLowerCase(Locale.ROOT);
        if (INLINE_CREDENTIAL_HEADERS.contains(normalized)) {
            return true;
        }
        String compact = normalized.replaceAll("[^a-z0-9]", "");
        return compact.contains("token") || compact.contains("secret") || compact.contains("credential")
                || compact.contains("password") || compact.contains("apikey")
                || compact.contains("signature") || compact.equals("bearer");
    }

    private UUID parseConnectionId(Object value) {
        if (value == null) {
            return null;
        }
        if (!(value instanceof String text) || text.length() != 36) {
            throw new Failure("CONFIGURATION_ERROR", "The connection reference is invalid.", false);
        }
        try {
            UUID id = UUID.fromString(text);
            if (!id.toString().equalsIgnoreCase(text)) {
                throw new IllegalArgumentException();
            }
            return id;
        } catch (IllegalArgumentException exception) {
            throw new Failure("CONFIGURATION_ERROR", "The connection reference is invalid.", false);
        }
    }

    private String requiredString(Object value, String label) {
        if (!(value instanceof String text) || text.isBlank() || text.length() > 16 * 1024
                || hasControl(text)) {
            throw new Failure("CONFIGURATION_ERROR", label + " is invalid.", false);
        }
        return text;
    }

    private boolean hasControl(String value) {
        return value.codePoints().anyMatch(codePoint -> codePoint < 0x20 || codePoint == 0x7f);
    }

    private String upper(String value) {
        return value == null ? "" : value.toUpperCase(Locale.ROOT);
    }

    private record Request(
            String method,
            URI uri,
            Map<String, String> headers,
            Object query,
            Object body,
            UUID connectionId) {
    }

    private record Authentication(Map<String, String> headers, Set<String> secrets) {
    }
}
