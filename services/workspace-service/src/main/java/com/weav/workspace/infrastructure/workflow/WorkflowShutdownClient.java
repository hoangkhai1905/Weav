package com.weav.workspace.infrastructure.workflow;

import com.weav.workspace.application.port.out.WorkflowShutdownPort;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.infrastructure.config.WorkflowServiceProperties;
import com.weav.workspace.infrastructure.web.RequestCorrelationFilter;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.time.Duration;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * Fail-closed HTTP adapter for the Workflow internal pause-all route. Mirrors
 * {@link WorkflowConnectionUsageClient}: bounded body, no redirects (configured on the shared RestClient),
 * a circuit breaker, and no downstream detail in exceptions or logs.
 */
public final class WorkflowShutdownClient implements WorkflowShutdownPort {

    private static final Logger log = LoggerFactory.getLogger(WorkflowShutdownClient.class);
    private static final String INTERNAL_KEY_HEADER = "X-Internal-Service-Key";
    private static final int MAX_RESPONSE_BYTES = 16 * 1024;

    private final RestClient restClient;
    private final WorkflowServiceProperties properties;
    private final ObjectMapper objectMapper;
    private final CircuitBreaker circuitBreaker;

    public WorkflowShutdownClient(
            RestClient restClient,
            WorkflowServiceProperties properties,
            ObjectMapper objectMapper,
            CircuitBreaker circuitBreaker) {
        this.restClient = Objects.requireNonNull(restClient, "restClient must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.circuitBreaker = Objects.requireNonNull(circuitBreaker, "circuitBreaker must not be null");
    }

    @Override
    public PauseAllResult pauseAll(UUID workspaceId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        if (!properties.hasServiceKey() || !circuitBreaker.tryAcquirePermission()) {
            throw new DependencyUnavailableException();
        }
        URI uri = URI.create(properties.baseUrl().toString().replaceAll("/+$", "")
                + "/internal/workspaces/" + workspaceId + "/pause-all");
        long started = System.nanoTime();
        try {
            Envelope response = restClient.post()
                    .uri(uri)
                    .header(INTERNAL_KEY_HEADER, properties.internalServiceKey())
                    .headers(headers -> {
                        String requestId = RequestCorrelationFilter.currentRequestId();
                        if (requestId != null) {
                            headers.set(RequestCorrelationFilter.HEADER_NAME, requestId);
                        }
                    })
                    .exchange((request, clientResponse) -> new Envelope(
                            clientResponse.getStatusCode().value(), readBounded(clientResponse.getBody())));
            if (response.status() != 200) {
                throw new IllegalStateException("unexpected status");
            }
            PauseAllResult result = parse(response.body());
            circuitBreaker.onSuccess(System.nanoTime() - started, TimeUnit.NANOSECONDS);
            return result;
        } catch (RuntimeException exception) {
            circuitBreaker.onError(System.nanoTime() - started, TimeUnit.NANOSECONDS, exception);
            log.warn("event=workflow_pause_all_failure requestId={} workspaceId={} errorType={} latencyMs={}",
                    RequestCorrelationFilter.currentRequestId(), workspaceId,
                    exception.getClass().getSimpleName(),
                    Duration.ofNanos(Math.max(0L, System.nanoTime() - started)).toMillis());
            throw new DependencyUnavailableException();
        }
    }

    private PauseAllResult parse(byte[] body) {
        JsonNode payload = objectMapper.readTree(body);
        if (payload == null || !payload.isObject()) {
            throw new IllegalStateException("invalid body");
        }
        return new PauseAllResult(count(payload, "paused"), count(payload, "alreadyPaused"),
                count(payload, "failedTelegramUnregister"), count(payload, "failed"));
    }

    private static int count(JsonNode payload, String field) {
        JsonNode value = payload.get(field);
        if (value == null || !value.isInt() || value.intValue() < 0) {
            throw new IllegalStateException("invalid count");
        }
        return value.intValue();
    }

    private static byte[] readBounded(InputStream body) {
        if (body == null) {
            throw new IllegalStateException("empty body");
        }
        try {
            byte[] bytes = body.readNBytes(MAX_RESPONSE_BYTES + 1);
            if (bytes.length > MAX_RESPONSE_BYTES) {
                throw new IllegalStateException("body too large");
            }
            return bytes;
        } catch (IOException exception) {
            throw new IllegalStateException("unreadable body");
        }
    }

    private record Envelope(int status, byte[] body) {
    }
}
