package com.weav.workspace.infrastructure.workflow;

import com.weav.workspace.application.port.out.WorkflowConnectionUsagePort;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.infrastructure.config.WorkflowServiceProperties;
import com.weav.workspace.infrastructure.web.RequestCorrelationFilter;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.TimeUnit;
import java.util.UUID;

/**
 * Bounded, fail-closed HTTP adapter for the Workflow connection usage
 * contract. Redirects are disabled in the configured JDK client so the
 * internal service key never follows a redirect to another origin.
 */
public final class WorkflowConnectionUsageClient implements WorkflowConnectionUsagePort {

    private static final Logger log = LoggerFactory.getLogger(WorkflowConnectionUsageClient.class);
    private static final String INTERNAL_KEY_HEADER = "X-Internal-Service-Key";
    private static final int MAX_RESPONSE_BYTES = 16 * 1024;
    private static final String USAGE_PATH = "/internal/workspaces/";

    private final RestClient restClient;
    private final WorkflowServiceProperties properties;
    private final ObjectMapper objectMapper;
    private final CircuitBreaker circuitBreaker;

    public WorkflowConnectionUsageClient(
            RestClient restClient,
            WorkflowServiceProperties properties,
            ObjectMapper objectMapper) {
        this(restClient, properties, objectMapper, circuitBreaker(20, 50f, 10, Duration.ofSeconds(10), 3));
    }

    public WorkflowConnectionUsageClient(
            RestClient restClient,
            WorkflowServiceProperties properties,
            ObjectMapper objectMapper,
            CircuitBreaker circuitBreaker) {
        this.circuitBreaker = Objects.requireNonNull(circuitBreaker, "circuitBreaker must not be null");
        this.restClient = Objects.requireNonNull(restClient, "restClient must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
    }

    @Override
    public boolean isInUse(UUID workspaceId, UUID connectionId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        String serviceKey = requiredServiceKey();
        URI usageUri = usageUri(workspaceId, connectionId);
        long started = System.nanoTime();
        try {
            ResponseEnvelope response = callUsage(usageUri, serviceKey);
            if (response.statusCode() != 200) {
                throw new InvalidUsageResponseException();
            }
            return parseInUse(response.body());
        } catch (DependencyUnavailableException exception) {
            logDependencyFailure(started);
            throw exception;
        } catch (RestClientException exception) {
            // Do not retain or expose downstream messages: they may contain
            // request details, response bodies, or transport diagnostics.
            logDependencyFailure(started);
            throw new DependencyUnavailableException();
        } catch (RuntimeException exception) {
            // Do not retain or expose downstream messages: they may contain
            // request details, response bodies, or transport diagnostics.
            logDependencyFailure(started);
            throw new DependencyUnavailableException();
        }
    }

    /**
     * Fail-closed: an open breaker throws the same DependencyUnavailableException as a
     * transport failure, so callers never treat "unknown usage" as "unused". Only transport
     * errors, timeouts and 5xx count against the breaker.
     */
    private ResponseEnvelope callUsage(URI usageUri, String serviceKey) {
        if (!circuitBreaker.tryAcquirePermission()) {
            throw new DependencyUnavailableException();
        }
        long started = System.nanoTime();
        try {
            ResponseEnvelope response = restClient.get()
                    .uri(usageUri)
                    .header(INTERNAL_KEY_HEADER, serviceKey)
                    .headers(headers -> {
                        String requestId = RequestCorrelationFilter.currentRequestId();
                        if (requestId != null) {
                            headers.set(RequestCorrelationFilter.HEADER_NAME, requestId);
                        }
                    })
                    .exchange((request, clientResponse) -> new ResponseEnvelope(
                            clientResponse.getStatusCode().value(),
                            readBounded(clientResponse.getBody())));
            long elapsed = System.nanoTime() - started;
            if (response.statusCode() >= 500) {
                circuitBreaker.onError(elapsed, TimeUnit.NANOSECONDS, new IllegalStateException("5xx"));
            } else {
                circuitBreaker.onSuccess(elapsed, TimeUnit.NANOSECONDS);
            }
            return response;
        } catch (RuntimeException exception) {
            circuitBreaker.onError(System.nanoTime() - started, TimeUnit.NANOSECONDS, exception);
            throw exception;
        }
    }

    public static CircuitBreaker circuitBreaker(
            int window, float failureRatePercent, int minimumCalls, Duration openFor, int halfOpenPermits) {
        CircuitBreaker breaker = CircuitBreaker.of("workflow-service", CircuitBreakerConfig.custom()
                .slidingWindowType(CircuitBreakerConfig.SlidingWindowType.COUNT_BASED)
                .slidingWindowSize(window)
                .failureRateThreshold(failureRatePercent)
                .minimumNumberOfCalls(minimumCalls)
                .waitDurationInOpenState(openFor)
                .permittedNumberOfCallsInHalfOpenState(halfOpenPermits)
                .build());
        breaker.getEventPublisher().onStateTransition(event ->
                log.warn("event=workflow_circuit_breaker_transition transition={}", event.getStateTransition()));
        return breaker;
    }

    private boolean parseInUse(byte[] body) {
        try {
            JsonNode payload = objectMapper.reader()
                    .with(tools.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .with(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .readTree(body);
            if (payload == null || !payload.isObject() || payload.size() != 1) {
                throw new InvalidUsageResponseException();
            }
            JsonNode inUse = payload.get("inUse");
            if (inUse == null || !inUse.isBoolean()) {
                throw new InvalidUsageResponseException();
            }
            return inUse.booleanValue();
        } catch (InvalidUsageResponseException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new InvalidUsageResponseException();
        }
    }

    private byte[] readBounded(InputStream body) {
        if (body == null) {
            throw new InvalidUsageResponseException();
        }
        try {
            byte[] bytes = body.readNBytes(MAX_RESPONSE_BYTES + 1);
            if (bytes.length > MAX_RESPONSE_BYTES) {
                throw new InvalidUsageResponseException();
            }
            return bytes;
        } catch (IOException exception) {
            throw new InvalidUsageResponseException();
        }
    }

    private URI usageUri(UUID workspaceId, UUID connectionId) {
        String base = properties.baseUrl().toString();
        String separator = base.endsWith("/") ? "" : "/";
        String value = base + separator + USAGE_PATH.substring(1)
                + workspaceId + "/connections/" + connectionId + "/usage";
        if (value.length() > 4096) {
            throw new DependencyUnavailableException();
        }
        try {
            return URI.create(value);
        } catch (IllegalArgumentException exception) {
            throw new DependencyUnavailableException();
        }
    }

    private String requiredServiceKey() {
        if (!properties.hasServiceKey()) {
            throw new DependencyUnavailableException();
        }
        return properties.internalServiceKey();
    }

    private void logDependencyFailure(long started) {
        log.warn("event=workflow_connection_usage_failure requestId={} operation=usage "
                        + "downstream=workflow-service errorType={} latencyMs={}",
                RequestCorrelationFilter.currentRequestId(),
                "DependencyUnavailableException",
                java.time.Duration.ofNanos(Math.max(0L, System.nanoTime() - started)).toMillis());
    }

    private record ResponseEnvelope(int statusCode, byte[] body) {
    }

    private static final class InvalidUsageResponseException extends RuntimeException {
    }
}
