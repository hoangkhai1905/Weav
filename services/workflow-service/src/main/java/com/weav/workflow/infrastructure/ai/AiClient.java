package com.weav.workflow.infrastructure.ai;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.AiGenerationPort;
import com.weav.workflow.infrastructure.http.OutputSanitizer;
import com.weav.workflow.infrastructure.security.ServiceJwtSigner;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.InputStream;
import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.regex.Pattern;

@Component
public class AiClient implements AiGenerationPort {
    private static final Set<String> AI_CODES = Set.of("INVALID_REQUEST", "UNAUTHENTICATED", "FORBIDDEN",
            "PAYLOAD_TOO_LARGE", "AI_SCHEMA_INVALID", "AI_BUSY", "AI_NOT_CONFIGURED", "AI_PROVIDER_UNAVAILABLE",
            "AI_PROVIDER_AUTH", "AI_OUTPUT_INVALID", "AI_TIMEOUT", "INTERNAL_ERROR");
    private static final Set<String> RETRYABLE = Set.of("AI_BUSY", "AI_PROVIDER_UNAVAILABLE", "AI_TIMEOUT");
    private static final Set<String> DEPENDENCY = Set.of("AI_NOT_CONFIGURED", "AI_PROVIDER_AUTH", "UNAUTHENTICATED", "FORBIDDEN");
    private static final Set<String> CONFIGURATION = Set.of("INVALID_REQUEST", "AI_SCHEMA_INVALID", "PAYLOAD_TOO_LARGE");
    private static final Pattern TRACEPARENT = Pattern.compile("^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$");

    private final AiClientProperties properties;
    private final ServiceJwtSigner signer;
    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final Consumer<UUID> quota;

    protected AiClient() {
        properties = null;
        signer = null;
        restClient = null;
        objectMapper = null;
        clock = null;
        quota = null;
    }

    @Autowired
    public AiClient(AiClientProperties properties, @Qualifier("aiServiceJwtSigner") ServiceJwtSigner signer,
                    @Qualifier("aiRestClient") RestClient restClient, ObjectMapper objectMapper, AiQuota quota) {
        this(properties, signer, restClient, objectMapper, Clock.systemUTC(), quota::consume);
    }

    AiClient(AiClientProperties properties, ServiceJwtSigner signer, RestClient restClient,
             ObjectMapper objectMapper, Clock clock) {
        this(properties, signer, restClient, objectMapper, clock, workspaceId -> { });
    }

    AiClient(AiClientProperties properties, ServiceJwtSigner signer, RestClient restClient,
             ObjectMapper objectMapper, Clock clock, Consumer<UUID> quota) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.signer = Objects.requireNonNull(signer, "signer must not be null");
        this.restClient = Objects.requireNonNull(restClient, "restClient must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
        this.quota = Objects.requireNonNull(quota, "quota must not be null");
    }

    public Map<String, Object> execute(NodeExecutor.Context context, String operation, Map<String, Object> payload) {
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("mode", "execution");
        claims.put("execution_id", context.executionId().toString());
        claims.put("node_execution_id", context.nodeExecutionId().toString());
        return call(context.workspaceId(), operation, payload, claims, context.traceparent(), properties.enabled(),
                requestId(context));
    }

    /** AI-1: the same execution/node/attempt always yields the same id, so ai-service can dedup a retried call. */
    static UUID requestId(NodeExecutor.Context context) {
        return UUID.nameUUIDFromBytes((context.executionId() + ":" + context.nodeId() + ":" + context.attemptNumber())
                .getBytes(StandardCharsets.UTF_8));
    }

    @Override
    public Map<String, Object> generate(UUID workspaceId, Map<String, Object> payload) {
        return call(workspaceId, "generate", payload, Map.of("mode", "generation"), null,
                properties.generationEnabled(), UUID.randomUUID());
    }

    private Map<String, Object> call(UUID workspaceId, String operation, Map<String, Object> payload,
                                     Map<String, Object> modeClaims, String traceparent, boolean enabled,
                                     UUID requestId) {
        if (!enabled) {
            throw new NodeExecutor.Failure("DEPENDENCY_NOT_CONFIGURED", "AI is not enabled.", false);
        }
        quota.accept(workspaceId);
        Map<String, Object> claims = new LinkedHashMap<>(modeClaims);
        claims.put("scope", "ai:" + operation);
        claims.put("workspace_id", workspaceId.toString());
        claims.put("request_id", requestId.toString());
        String token;
        try {
            token = signer.sign("weav-workflow", "weav-ai", claims, Instant.now(clock));
        } catch (ServiceJwtSigner.Unavailable exception) {
            throw new NodeExecutor.Failure("DEPENDENCY_NOT_CONFIGURED", "AI service authentication is not configured.", false);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("requestId", requestId.toString());
        body.put("workspaceId", workspaceId.toString());
        body.put("operation", operation);
        body.putAll(payload);
        Response response;
        try {
            byte[] requestBody = objectMapper.writeValueAsBytes(body);
            response = restClient.post()
                    .uri(properties.baseUrl().resolve("/v1/" + operation))
                    .headers(headers -> {
                        headers.setBearerAuth(token);
                        headers.setContentType(MediaType.APPLICATION_JSON);
                        headers.setAccept(List.of(MediaType.APPLICATION_JSON));
                        headers.set("X-Request-ID", requestId.toString());
                        if (traceparent != null && TRACEPARENT.matcher(traceparent).matches()) {
                            headers.set("traceparent", traceparent);
                        }
                    })
                    .body(requestBody)
                    .exchange((request, clientResponse) -> {
                        try (InputStream input = clientResponse.getBody()) {
                            return new Response(clientResponse.getStatusCode().value(),
                                    input.readNBytes(properties.maxResponseBytes() + 1));
                        }
                    });
        } catch (RestClientException exception) {
            Throwable cause = exception.getCause();
            boolean timeout = cause instanceof java.net.http.HttpTimeoutException
                    || cause instanceof java.net.SocketTimeoutException;
            throw new NodeExecutor.Failure(timeout ? "TIMEOUT" : "NETWORK_ERROR", "The AI service could not be reached.", true);
        }
        if (response.body().length > properties.maxResponseBytes()) {
            throw invalidResponse();
        }
        JsonNode root = parseStrict(response.body());
        if (response.status() != 200) {
            throw errorFailure(root);
        }
        if (root == null || root.size() != 2 || !root.path("requestId").isString()
                || !requestId.toString().equals(root.get("requestId").stringValue()) || !root.path("result").isObject()) {
            throw invalidResponse();
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> result = objectMapper.convertValue(root.get("result"), Map.class);
        @SuppressWarnings("unchecked")
        Map<String, Object> sanitized = (Map<String, Object>) OutputSanitizer.sanitize(result, Set.of(token));
        return sanitized;
    }

    private NodeExecutor.Failure errorFailure(JsonNode root) {
        JsonNode code = root == null ? null : root.path("error").path("code");
        if (code == null || !code.isString() || !AI_CODES.contains(code.stringValue())) {
            return invalidResponse();
        }
        String value = code.stringValue();
        if (DEPENDENCY.contains(value)) {
            return new NodeExecutor.Failure("DEPENDENCY_NOT_CONFIGURED", "The AI service is not available for this request.", false);
        }
        if (CONFIGURATION.contains(value)) {
            return new NodeExecutor.Failure("CONFIGURATION_ERROR", "The AI node configuration is invalid.", false);
        }
        return new NodeExecutor.Failure(value, "The AI service could not complete this step.", RETRYABLE.contains(value));
    }

    private JsonNode parseStrict(byte[] body) {
        try {
            JsonNode node = objectMapper.reader()
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .with(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .readTree(body);
            return node != null && node.isObject() ? node : null;
        } catch (RuntimeException exception) {
            return null;
        }
    }

    private static NodeExecutor.Failure invalidResponse() {
        return new NodeExecutor.Failure("AI_RESPONSE_INVALID", "The AI service returned an invalid response.", false);
    }

    private record Response(int status, byte[] body) {
    }
}
