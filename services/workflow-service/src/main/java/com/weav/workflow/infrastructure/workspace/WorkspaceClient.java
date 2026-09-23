package com.weav.workflow.infrastructure.workspace;

import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.infrastructure.web.CorrelationIdFilter;
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

    private static final Set<String> PROVIDERS = Set.of("TELEGRAM", "HTTP", "GMAIL", "GOOGLE_SHEETS");
    private static final Map<String, Set<String>> AUTH_FIELDS = Map.of(
            "OAUTH2", Set.of("accessToken"),
            "TOKEN", Set.of("token"),
            "API_KEY", Set.of("apiKey"),
            "BASIC", Set.of("username", "password"),
            "NONE", Set.of());

    private final RestClient restClient;
    private final WorkspaceClientProperties properties;
    private final ObjectMapper objectMapper;

    public WorkspaceClient(WorkspaceClientProperties properties, ObjectMapper objectMapper) {
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
        long started = System.nanoTime();
        String path = INTERNAL_PREFIX + workspaceId + "/users/" + userId + "/access";
        ResponseEnvelope response = send("access", HttpMethod.GET, path, null, started);
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
        ResponseEnvelope response = send("attachment", HttpMethod.POST, path, body, started);
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
        ResponseEnvelope response = send("resolve", HttpMethod.POST, path, null, started);
        if (isDenied(response.statusCode())) {
            throw new ForbiddenException();
        }
        if (response.statusCode() != 200
                || !isJson(response.contentType())
                || !hasNoStore(response.cacheControl())) {
            throw unavailable("resolve", started);
        }
        try {
            JsonNode payload = parseObject(response.body());
            if (payload.size() != 3) {
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
            return new ResolvedConnection(provider, authType, auth);
        } catch (RuntimeException exception) {
            throw unavailable("resolve", started);
        }
    }

    @Override
    public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        long started = System.nanoTime();
        byte[] body = jsonBody(Map.of("failureCode", "AUTHENTICATION_REJECTED"));
        String path = INTERNAL_PREFIX + workspaceId + "/connections/" + connectionId + "/auth-failure";
        ResponseEnvelope response = send("auth-failure", HttpMethod.POST, path, body, started);
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
            long started) {
        String serviceKey = requiredServiceKey();
        URI uri = endpoint(path, operation, started);
        try {
            RestClient.RequestBodySpec request = restClient.method(method)
                    .uri(uri)
                    .header(INTERNAL_KEY_HEADER, serviceKey)
                    .accept(MediaType.APPLICATION_JSON)
                    .headers(headers -> {
                        String correlationId = CorrelationIdFilter.currentCorrelationId();
                        if (correlationId != null) {
                            headers.set(CorrelationIdFilter.HEADER_NAME, correlationId);
                        }
                    });
            if (body != null) {
                request.contentType(MediaType.APPLICATION_JSON).body(body);
            }
            return request.exchange((clientRequest, clientResponse) -> new ResponseEnvelope(
                    clientResponse.getStatusCode().value(),
                    clientResponse.getHeaders().getFirst(HttpHeaders.CONTENT_TYPE),
                    clientResponse.getHeaders().getFirst(HttpHeaders.CACHE_CONTROL),
                    readBounded(clientResponse.getBody())));
        } catch (RuntimeException exception) {
            throw unavailable(operation, started);
        }
    }

    private String requiredServiceKey() {
        if (!properties.hasServiceKey()) {
            throw new WorkspaceDependencyUnavailableException();
        }
        return properties.internalServiceKey();
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
