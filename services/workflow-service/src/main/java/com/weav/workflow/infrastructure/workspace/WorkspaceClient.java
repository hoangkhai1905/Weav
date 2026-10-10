package com.weav.workflow.infrastructure.workspace;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.Ticker;
import com.weav.workflow.application.port.out.ConnectionReconnectRequiredException;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.domain.exception.WorkspaceNotFoundException;
import com.weav.workflow.infrastructure.security.ServiceJwtSigner;
import com.weav.workflow.infrastructure.web.CorrelationIdFilter;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.TimeUnit;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** Bounded, fail-closed adapter for Workspace's documented internal APIs. */
public final class WorkspaceClient implements WorkspaceAccessPort, WorkspaceConnectionPort {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceClient.class);
    private static final String INTERNAL_KEY_HEADER = "X-Internal-Service-Key";
    private static final String INTERNAL_PREFIX = "/internal/workspaces/";
    private static final int MAX_RESPONSE_BYTES = 16 * 1024;

    private static final Set<String> PROVIDERS = Set.of("TELEGRAM", "HTTP", "GMAIL", "GOOGLE_SHEETS",
            "GOOGLE_CALENDAR", "GOOGLE_DRIVE", "DISCORD");
    private static final Map<String, Set<String>> AUTH_FIELDS = Map.of(
            "OAUTH2", Set.of("accessToken"),
            "TOKEN", Set.of("token"),
            "API_KEY", Set.of("apiKey"),
            "BASIC", Set.of("username", "password"),
            "NONE", Set.of());

    private final RestClient restClient;
    private final WorkspaceClientProperties properties;
    private final ObjectMapper objectMapper;
    private final CircuitBreaker circuitBreaker;
    /** Null when no signing key is configured: then only the legacy static key header is sent. */
    private final ServiceJwtSigner serviceJwtSigner;
    /** Only access-check answers are cached: Access, DENIED or NOT_FOUND. Never errors, never credentials. */
    private final Cache<AccessKey, Object> accessCache;

    private static final Object DENIED = new Object();
    private static final Object NOT_FOUND = new Object();
    private static final int ACCESS_CACHE_MAX_ENTRIES = 10_000;

    private record AccessKey(UUID workspaceId, UUID userId) {
    }

    public WorkspaceClient(WorkspaceClientProperties properties, ObjectMapper objectMapper) {
        this(properties, objectMapper,
                circuitBreaker(20, 50f, 10, Duration.ofSeconds(10), 3), Duration.ofSeconds(30), Ticker.systemTicker());
    }

    /** Count-based breaker; 4xx never count (see send), only transport errors, timeouts and 5xx do. */
    public static CircuitBreaker circuitBreaker(
            int window, float failureRatePercent, int minimumCalls, Duration openFor, int halfOpenPermits) {
        CircuitBreaker breaker = CircuitBreaker.of("workspace-service", CircuitBreakerConfig.custom()
                .slidingWindowType(CircuitBreakerConfig.SlidingWindowType.COUNT_BASED)
                .slidingWindowSize(window)
                .failureRateThreshold(failureRatePercent)
                .minimumNumberOfCalls(minimumCalls)
                .waitDurationInOpenState(openFor)
                .permittedNumberOfCallsInHalfOpenState(halfOpenPermits)
                .build());
        breaker.getEventPublisher().onStateTransition(event ->
                log.warn("event=workspace_circuit_breaker_transition transition={}", event.getStateTransition()));
        return breaker;
    }

    public WorkspaceClient(
            WorkspaceClientProperties properties,
            ObjectMapper objectMapper,
            CircuitBreaker circuitBreaker,
            Duration accessCacheTtl,
            Ticker ticker) {
        this(properties, objectMapper, circuitBreaker, accessCacheTtl, ticker, null);
    }

    public WorkspaceClient(
            WorkspaceClientProperties properties,
            ObjectMapper objectMapper,
            CircuitBreaker circuitBreaker,
            Duration accessCacheTtl,
            Ticker ticker,
            ServiceJwtSigner serviceJwtSigner) {
        this.serviceJwtSigner = serviceJwtSigner;
        this.circuitBreaker = Objects.requireNonNull(circuitBreaker, "circuitBreaker must not be null");
        this.accessCache = Caffeine.newBuilder()
                .maximumSize(ACCESS_CACHE_MAX_ENTRIES)
                .expireAfterWrite(accessCacheTtl)
                .ticker(ticker)
                .build();
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");

        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(properties.connectTimeout())
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(properties.readTimeout());
        this.restClient = RestClient.builder().requestFactory(requestFactory).build();
    }

    @Override
    public Access getAccess(UUID workspaceId, UUID userId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(userId, "userId must not be null");
        AccessKey key = new AccessKey(workspaceId, userId);
        Object cached = accessCache.getIfPresent(key);
        if (cached == DENIED) {
            throw new ForbiddenException();
        }
        if (cached == NOT_FOUND) {
            throw new WorkspaceNotFoundException();
        }
        if (cached instanceof Access access) {
            return access;
        }
        try {
            Access access = fetchAccess(workspaceId, userId);
            accessCache.put(key, access);
            return access;
        } catch (WorkspaceNotFoundException missing) {
            accessCache.put(key, NOT_FOUND);
            throw missing;
        } catch (ForbiddenException denied) {
            accessCache.put(key, DENIED);
            throw denied;
        }
    }

    private Access fetchAccess(UUID workspaceId, UUID userId) {
        long started = System.nanoTime();
        String path = INTERNAL_PREFIX + workspaceId + "/users/" + userId + "/access";
        ResponseEnvelope response = send("access", HttpMethod.GET, path, null, started, "workspace:access", workspaceId, null);
        if (response.statusCode() == 404) {
            // 404 = the caller is not a member, or the workspace is deleted/missing (workspace-service cannot tell
            // them apart). Answered as 404; 403 stays for a member lacking the capability.
            throw new WorkspaceNotFoundException();
        }
        if (isDenied(response.statusCode())) {
            throw new ForbiddenException();
        }
        if (response.statusCode() != 200 || !isJson(response.contentType())) {
            throw unavailable("access", started);
        }
        try {
            JsonNode payload = parseObject(response.body());
            if (payload.size() != 4) {
                throw new InvalidWorkspaceResponseException();
            }
            UUID actualWorkspaceId = uuidField(payload, "workspaceId");
            UUID actualUserId = uuidField(payload, "userId");
            String role = textField(payload, "role");
            JsonNode capabilityValues = payload.get("capabilities");
            if (capabilityValues == null || !capabilityValues.isArray()) {
                throw new InvalidWorkspaceResponseException();
            }
            LinkedHashSet<String> capabilities = new LinkedHashSet<>();
            for (JsonNode value : capabilityValues) {
                if (!value.isString()) {
                    throw new InvalidWorkspaceResponseException();
                }
                String capability = value.stringValue();
                if (capability.isBlank() || capability.length() > 128) {
                    throw new InvalidWorkspaceResponseException();
                }
                capabilities.add(capability);
            }
            if (!workspaceId.equals(actualWorkspaceId) || !userId.equals(actualUserId)) {
                throw new InvalidWorkspaceResponseException();
            }
            return new Access(actualWorkspaceId, actualUserId, role, capabilities);
        } catch (RuntimeException exception) {
            throw unavailable("access", started);
        }
    }

    @Override
    public void authorizeAttachment(UUID workspaceId, UUID connectionId, UUID userId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        Objects.requireNonNull(userId, "userId must not be null");
        long started = System.nanoTime();
        byte[] body = jsonBody(Map.of("userId", userId.toString()));
        String path = INTERNAL_PREFIX + workspaceId + "/connections/" + connectionId + "/authorize-attachment";
        ResponseEnvelope response = send("attachment", HttpMethod.POST, path, body, started, "connection:authorize-attachment", workspaceId, connectionId);
        if (isDenied(response.statusCode())) {
            throw new ForbiddenException();
        }
        if (response.statusCode() != 204 || response.body().length != 0) {
            throw unavailable("attachment", started);
        }
    }

    @Override
    public ResolvedConnection resolve(UUID workspaceId, UUID connectionId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        long started = System.nanoTime();
        String path = INTERNAL_PREFIX + workspaceId + "/connections/" + connectionId + "/resolve";
        ResponseEnvelope response = send("resolve", HttpMethod.POST, path, null, started, "connection:resolve", workspaceId, connectionId);
        if (isDenied(response.statusCode())) {
            throw new ForbiddenException();
        }
        if (response.statusCode() == 422 && isReconnectRequired(response.body())) {
            throw new ConnectionReconnectRequiredException();
        }
        if (response.statusCode() != 200
                || !isJson(response.contentType())
                || !hasNoStore(response.cacheControl())) {
            throw unavailable("resolve", started);
        }
        try {
            JsonNode payload = parseObject(response.body());
            // Additive WS-11 fields: credentialId/credentialVersion are optional, nothing else is allowed.
            int expectedSize = 3 + (payload.has("credentialId") ? 1 : 0) + (payload.has("credentialVersion") ? 1 : 0);
            if (payload.size() != expectedSize) {
                throw new InvalidWorkspaceResponseException();
            }
            String provider = textField(payload, "provider");
            String authType = textField(payload, "authType");
            if (!PROVIDERS.contains(provider)) {
                throw new InvalidWorkspaceResponseException();
            }
            Set<String> expectedFields = AUTH_FIELDS.get(authType);
            JsonNode authNode = payload.get("auth");
            if (expectedFields == null || authNode == null || !authNode.isObject()
                    || authNode.size() != expectedFields.size()) {
                throw new InvalidWorkspaceResponseException();
            }
            Map<String, String> auth = new LinkedHashMap<>();
            for (String field : expectedFields) {
                auth.put(field, textField(authNode, field));
            }
            UUID credentialId = null;
            Long credentialVersion = null;
            if (payload.hasNonNull("credentialVersion")) {
                if (!payload.get("credentialVersion").isIntegralNumber()) {
                    throw new InvalidWorkspaceResponseException();
                }
                credentialVersion = payload.get("credentialVersion").asLong();
            }
            if (payload.hasNonNull("credentialId")) {
                credentialId = UUID.fromString(textField(payload, "credentialId"));
            }
            return new ResolvedConnection(provider, authType, auth, credentialId, credentialVersion);
        } catch (RuntimeException exception) {
            throw unavailable("resolve", started);
        }
    }

    @Override
    public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
        reportAuthenticationRejected(workspaceId, connectionId, null);
    }

    @Override
    public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId, ResolvedConnection resolved) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        long started = System.nanoTime();
        Map<String, Object> report = new LinkedHashMap<>();
        report.put("failureCode", "AUTHENTICATION_REJECTED");
        if (resolved != null && resolved.credentialId() != null) {
            report.put("credentialId", resolved.credentialId().toString());
        }
        if (resolved != null && resolved.credentialVersion() != null) {
            report.put("credentialVersion", resolved.credentialVersion());
        }
        byte[] body = jsonBody(report);
        String path = INTERNAL_PREFIX + workspaceId + "/connections/" + connectionId + "/auth-failure";
        ResponseEnvelope response = send("auth-failure", HttpMethod.POST, path, body, started, "connection:report-auth-failure", workspaceId, connectionId);
        if (isDenied(response.statusCode())) {
            throw new ForbiddenException();
        }
        if (response.statusCode() != 204 || response.body().length != 0) {
            throw unavailable("auth-failure", started);
        }
    }

    private ResponseEnvelope send(
            String operation,
            HttpMethod method,
            String path,
            byte[] body,
            long started,
            String scope,
            UUID workspaceId,
            UUID connectionId) {
        String serviceKey = properties.hasServiceKey() ? properties.internalServiceKey() : null;
        String jwt = serviceJwt(scope, workspaceId, connectionId);
        if (serviceKey == null && jwt == null) {
            throw new WorkspaceDependencyUnavailableException();
        }
        URI uri = endpoint(path, operation, started);
        if (!circuitBreaker.tryAcquirePermission()) {
            throw new WorkspaceDependencyUnavailableException();
        }
        long breakerStarted = System.nanoTime();
        try {
            RestClient.RequestBodySpec request = restClient.method(method)
                    .uri(uri)
                    .accept(MediaType.APPLICATION_JSON)
                    .headers(headers -> {
                        // Transition: the legacy key is still sent next to the JWT until Workspace requires JWTs.
                        if (serviceKey != null) {
                            headers.set(INTERNAL_KEY_HEADER, serviceKey);
                        }
                        if (jwt != null) {
                            headers.setBearerAuth(jwt);
                        }
                        String correlationId = CorrelationIdFilter.currentCorrelationId();
                        if (correlationId != null) {
                            headers.set(CorrelationIdFilter.HEADER_NAME, correlationId);
                        }
                    });
            if (body != null) {
                request.contentType(MediaType.APPLICATION_JSON).body(body);
            }
            ResponseEnvelope envelope = request.exchange((clientRequest, clientResponse) -> new ResponseEnvelope(
                    clientResponse.getStatusCode().value(),
                    clientResponse.getHeaders().getFirst(HttpHeaders.CONTENT_TYPE),
                    clientResponse.getHeaders().getFirst(HttpHeaders.CACHE_CONTROL),
                    readBounded(clientResponse.getBody())));
            long elapsed = System.nanoTime() - breakerStarted;
            if (envelope.statusCode() >= 500) {
                circuitBreaker.onError(elapsed, TimeUnit.NANOSECONDS, new IllegalStateException("5xx"));
            } else {
                circuitBreaker.onSuccess(elapsed, TimeUnit.NANOSECONDS);
            }
            return envelope;
        } catch (RuntimeException exception) {
            circuitBreaker.onError(System.nanoTime() - breakerStarted, TimeUnit.NANOSECONDS, exception);
            throw unavailable(operation, started);
        }
    }

    /** One 60 s scoped token per call; null when no signer is configured or signing fails (legacy key only). */
    private String serviceJwt(String scope, UUID workspaceId, UUID connectionId) {
        if (serviceJwtSigner == null) {
            return null;
        }
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("scope", scope);
        claims.put("workspace_id", workspaceId.toString());
        if (connectionId != null) {
            claims.put("connection_id", connectionId.toString());
        }
        try {
            return serviceJwtSigner.sign("weav-workflow", "weav-workspace", claims, Instant.now());
        } catch (ServiceJwtSigner.Unavailable exception) {
            log.warn("event=workspace_service_jwt_unavailable scope={}", scope);
            return null;
        }
    }

    private URI endpoint(String path, String operation, long started) {
        String base = properties.baseUrl().toString();
        String separator = base.endsWith("/") ? "" : "/";
        String uriValue = base + separator + path.substring(1);
        if (uriValue.length() > 4096) {
            throw unavailable(operation, started);
        }
        try {
            return URI.create(uriValue);
        } catch (IllegalArgumentException exception) {
            throw unavailable(operation, started);
        }
    }

    private byte[] jsonBody(Object value) {
        try {
            return objectMapper.writeValueAsBytes(value);
        } catch (RuntimeException exception) {
            throw new WorkspaceDependencyUnavailableException();
        }
    }

    private byte[] readBounded(InputStream body) {
        if (body == null) {
            throw new InvalidWorkspaceResponseException();
        }
        try {
            byte[] bytes = body.readNBytes(MAX_RESPONSE_BYTES + 1);
            if (bytes.length > MAX_RESPONSE_BYTES) {
                throw new InvalidWorkspaceResponseException();
            }
            return bytes;
        } catch (IOException exception) {
            throw new InvalidWorkspaceResponseException();
        }
    }

    private JsonNode parseObject(byte[] body) {
        try {
            JsonNode payload = objectMapper.reader()
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .with(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .readTree(body);
            if (payload == null || !payload.isObject()) {
                throw new InvalidWorkspaceResponseException();
            }
            return payload;
        } catch (RuntimeException exception) {
            throw new InvalidWorkspaceResponseException();
        }
    }

    private UUID uuidField(JsonNode parent, String field) {
        String value = textField(parent, field);
        try {
            UUID uuid = UUID.fromString(value);
            if (!uuid.toString().equalsIgnoreCase(value)) {
                throw new InvalidWorkspaceResponseException();
            }
            return uuid;
        } catch (IllegalArgumentException exception) {
            throw new InvalidWorkspaceResponseException();
        }
    }

    private String textField(JsonNode parent, String field) {
        JsonNode value = parent.get(field);
        if (value == null || !value.isString()) {
            throw new InvalidWorkspaceResponseException();
        }
        String result = value.stringValue();
        if (result.isBlank() || result.length() > 16 * 1024) {
            throw new InvalidWorkspaceResponseException();
        }
        return result;
    }

    private boolean isJson(String contentType) {
        if (contentType == null) {
            return false;
        }
        try {
            return MediaType.APPLICATION_JSON.isCompatibleWith(MediaType.parseMediaType(contentType));
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private boolean hasNoStore(String cacheControl) {
        if (cacheControl == null) {
            return false;
        }
        return Arrays.stream(cacheControl.split(","))
                .map(String::trim)
                .anyMatch("no-store"::equalsIgnoreCase);
    }

    /** Additive Workspace error code on the 422 resolve response: the stored Google grant must be redone. */
    private boolean isReconnectRequired(byte[] body) {
        try {
            return ConnectionReconnectRequiredException.CODE.equals(textField(parseObject(body), "code"));
        } catch (RuntimeException exception) {
            return false;
        }
    }

    private boolean isDenied(int statusCode) {
        return statusCode == 403 || statusCode == 404;
    }

    private WorkspaceDependencyUnavailableException unavailable(String operation, long started) {
        log.warn("event=workspace_dependency_failure requestId={} operation={} downstream=workspace-service "
                        + "errorType=WorkspaceDependencyUnavailableException latencyMs={}",
                CorrelationIdFilter.currentCorrelationId(),
                operation,
                java.time.Duration.ofNanos(Math.max(0L, System.nanoTime() - started)).toMillis());
        return new WorkspaceDependencyUnavailableException();
    }

    private record ResponseEnvelope(int statusCode, String contentType, String cacheControl, byte[] body) {
    }

    private static final class InvalidWorkspaceResponseException extends RuntimeException {
    }
}
