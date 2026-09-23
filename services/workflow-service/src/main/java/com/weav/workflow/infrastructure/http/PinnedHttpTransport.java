package com.weav.workflow.infrastructure.http;

import com.weav.workflow.application.node.NodeExecutor;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.InMemoryDnsResolver;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.CloseableHttpResponse;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.ManagedHttpClientConnectionFactory;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.client5.http.ssl.DefaultHostnameVerifier;
import org.apache.hc.client5.http.ssl.SSLConnectionSocketFactoryBuilder;
import org.apache.hc.client5.http.classic.methods.HttpUriRequestBase;
import org.apache.hc.core5.http.ContentType;
import org.apache.hc.core5.http.Header;
import org.apache.hc.core5.http.HttpEntity;
import org.apache.hc.core5.http.MessageConstraintException;
import org.apache.hc.core5.http.config.Http1Config;
import org.apache.hc.core5.http.io.entity.ByteArrayEntity;
import org.apache.hc.core5.net.URIBuilder;
import org.apache.hc.core5.util.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;
import javax.net.ssl.SSLContext;

/**
 * One-shot HTTP transport for a destination that has already been DNS
 * validated. Each request installs the approved addresses into an in-memory
 * resolver, so Apache never performs a second DNS lookup.
 */
@Component
public class PinnedHttpTransport {

    private static final Set<String> METHODS = Set.of(
            "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS");
    private static final Pattern HEADER_NAME = Pattern.compile("^[!#$%&'*+.^_`|~0-9A-Za-z-]+$");
    private static final String GOOGLE_SHEETS_HOST = "sheets.googleapis.com";
    private static final Set<String> FORBIDDEN_HEADERS = Set.of(
            "host", "content-length", "transfer-encoding", "connection", "proxy-connection",
            "keep-alive", "te", "trailer", "upgrade", "authorization", "proxy-authorization",
            "cookie", "set-cookie", "x-api-key", "api-key");
    private static final ScheduledThreadPoolExecutor DEADLINE_EXECUTOR = createDeadlineExecutor();

    private final Duration connectTimeout;
    private final Duration callTimeout;
    private final int maxRequestBytes;
    private final int maxResponseBytes;
    private final int maxHeaderBytes;
    private final ObjectMapper objectMapper;
    private final OutboundTargetPolicy targetPolicy;
    private final SSLContext testSslContext;

    @Autowired
    public PinnedHttpTransport(
            OutboundHttpProperties properties,
            ObjectMapper objectMapper,
            OutboundTargetPolicy targetPolicy) {
        this(Objects.requireNonNull(properties, "properties must not be null").connectTimeout(),
                properties.callTimeout(), properties.maxRequestBytes(), properties.maxResponseBytes(),
                properties.maxHeaderBytes(), objectMapper, targetPolicy, null);
    }

    public PinnedHttpTransport(OutboundHttpProperties properties, ObjectMapper objectMapper) {
        this(properties, objectMapper, new OutboundTargetPolicy());
    }

    public PinnedHttpTransport() {
        this(new OutboundHttpProperties(), new ObjectMapper(), new OutboundTargetPolicy());
    }

    public PinnedHttpTransport(Duration connectTimeout, Duration callTimeout) {
        this(connectTimeout, callTimeout, OutboundHttpProperties.DEFAULT_MAX_REQUEST_BYTES,
                OutboundHttpProperties.DEFAULT_MAX_RESPONSE_BYTES,
                OutboundHttpProperties.DEFAULT_MAX_HEADER_BYTES, new ObjectMapper(),
                new OutboundTargetPolicy(), null);
    }

    public PinnedHttpTransport(
            Duration connectTimeout,
            Duration callTimeout,
            int maxRequestBytes,
            int maxResponseBytes,
            int maxHeaderBytes,
            ObjectMapper objectMapper) {
        this(connectTimeout, callTimeout, maxRequestBytes, maxResponseBytes, maxHeaderBytes,
                objectMapper, new OutboundTargetPolicy(), null);
    }

    PinnedHttpTransport(
            Duration connectTimeout,
            Duration callTimeout,
            int maxRequestBytes,
            int maxResponseBytes,
            int maxHeaderBytes,
            ObjectMapper objectMapper,
            OutboundTargetPolicy targetPolicy,
            SSLContext testSslContext) {
        this.connectTimeout = positive(connectTimeout, "connectTimeout");
        this.callTimeout = positive(callTimeout, "callTimeout");
        this.maxRequestBytes = positiveBytes(maxRequestBytes, "maxRequestBytes");
        this.maxResponseBytes = positiveBytes(maxResponseBytes, "maxResponseBytes");
        this.maxHeaderBytes = positiveBytes(maxHeaderBytes, "maxHeaderBytes");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.targetPolicy = Objects.requireNonNull(targetPolicy, "targetPolicy must not be null");
        this.testSslContext = testSslContext;
    }

    /**
     * Executes one request. The transport never follows redirects or retries
     * a request implicitly. Response data is decoded as JSON when the
     * provider declares a JSON content type and otherwise returned as UTF-8
     * text.
     */
    public HttpResponse execute(
            OutboundTargetPolicy.ApprovedTarget target,
            String method,
            Map<String, String> headers,
            Object query,
            Object body) {
        return executeWithAuthentication(target, method, headers, Map.of(), query, body);
    }

    /**
     * Executes a Google Sheets API call with Workspace-owned OAuth credentials.
     * The endpoint is fixed to the Sheets HTTPS host and DNS is approved and
     * pinned here immediately before the request is sent.
     */
    public HttpResponse executeGoogleSheetsWithBearerToken(
            URI uri,
            String method,
            Object query,
            Object body,
            String accessToken) {
        validateGoogleSheetsUri(uri);
        if (accessToken == null || accessToken.isBlank() || accessToken.length() > 16 * 1024
                || accessToken.codePoints().anyMatch(Character::isISOControl)) {
            throw new NodeExecutor.Failure("HTTP_REQUEST_INVALID",
                    "The Sheets authentication configuration is invalid.", false);
        }
        OutboundTargetPolicy.ApprovedTarget target = targetPolicy.approve(uri);
        return executeWithAuthentication(target, method, Map.of(),
                Map.of("Authorization", "Bearer " + accessToken), query, body);
    }

    /**
     * Package-scoped authentication entry point. User supplied headers are
     * validated separately from the short-lived headers created by the node
     * executor, so credential-bearing values cannot be smuggled through node
     * configuration.
     */
    HttpResponse executeWithAuthentication(
            OutboundTargetPolicy.ApprovedTarget target,
            String method,
            Map<String, String> headers,
            Map<String, String> authenticationHeaders,
            Object query,
            Object body) {
        Objects.requireNonNull(target, "target must not be null");
        String normalizedMethod = normalizeMethod(method);
        Map<String, String> safeHeaders = validateHeaders(headers);
        Map<String, String> safeAuthenticationHeaders = validateAuthenticationHeaders(authenticationHeaders);
        Map<String, String> requestHeaders = mergeHeaders(safeHeaders, safeAuthenticationHeaders);
        URI requestUri = withQuery(target.original(), query);
        byte[] bodyBytes = serializeBody(body);
        if (bodyBytes.length > maxRequestBytes) {
            throw new NodeExecutor.Failure("HTTP_REQUEST_TOO_LARGE",
                    "The HTTP request body exceeds the supported size.", false);
        }

        InMemoryDnsResolver resolver = new InMemoryDnsResolver();
        InetAddressSet.install(resolver, target);
        RequestConfig requestConfig = RequestConfig.custom()
                .setConnectTimeout(Timeout.of(connectTimeout))
                .setResponseTimeout(Timeout.of(callTimeout))
                .setConnectionRequestTimeout(Timeout.of(connectTimeout))
                .setRedirectsEnabled(false)
                .build();
        var managerBuilder = PoolingHttpClientConnectionManagerBuilder.create()
                .setDnsResolver(resolver)
                // Bound parser allocations before the stricter aggregate byte
                // check below. HTTP/1 currently permits at most 256 headers,
                // with each line capped at 8 KiB (minimum 1 KiB for status and
                // standard headers).
                .setConnectionFactory(ManagedHttpClientConnectionFactory.builder()
                        .http1Config(Http1Config.custom()
                                .setMaxHeaderCount(256)
                                .setMaxLineLength(Math.max(1024, Math.min(maxHeaderBytes, 8 * 1024)))
                                .build())
                        .build())
                .setMaxConnTotal(1)
                .setMaxConnPerRoute(1);
        if (testSslContext != null) {
            managerBuilder.setSSLSocketFactory(SSLConnectionSocketFactoryBuilder.create()
                    .setSslContext(testSslContext)
                    .setHostnameVerifier(new DefaultHostnameVerifier())
                    .build());
        }
        var manager = managerBuilder.build();
        HttpUriRequestBase request = new HttpUriRequestBase(normalizedMethod, requestUri);
        // The transport owns framing; callers cannot smuggle a second
        // connection or content-length header through the workflow config.
        request.setHeader("Connection", "close");
        requestHeaders.forEach(request::setHeader);
        if (body != null) {
            request.setEntity(new ByteArrayEntity(bodyBytes, ContentType.APPLICATION_JSON));
        }
        AtomicBoolean deadlineExpired = new AtomicBoolean();

        try (CloseableHttpClient client = HttpClients.custom()
                .setConnectionManager(manager)
                .setDefaultRequestConfig(requestConfig)
                .disableRedirectHandling()
                .disableAutomaticRetries()
                .disableContentCompression()
                .build()) {
            ScheduledFuture<?> deadline = DEADLINE_EXECUTOR.schedule(() -> {
                deadlineExpired.set(true);
                request.cancel();
            }, callTimeout.toNanos(), TimeUnit.NANOSECONDS);
            try {
                try (CloseableHttpResponse response = client.execute(request)) {
                    if (deadlineExpired.get()) {
                        throw timeoutFailure();
                    }
                    Set<String> activeRequestSecrets = Set.copyOf(safeAuthenticationHeaders.values());
                    HeaderSnapshot responseHeaders = readHeaders(response.getHeaders(), activeRequestSecrets);
                    HttpEntity entity = response.getEntity();
                    byte[] responseBody = entity == null ? new byte[0] : readBounded(entity);
                    Object data = decode(entity, responseBody);
                    if (deadlineExpired.get()) {
                        throw timeoutFailure();
                    }
                    return new HttpResponse(response.getCode(), data, responseHeaders.values());
                }
            } finally {
                deadline.cancel(false);
            }
        } catch (ResponseTooLargeException exception) {
            throw new NodeExecutor.Failure("HTTP_RESPONSE_TOO_LARGE",
                    "The HTTP response exceeds the supported size.", false);
        } catch (MessageConstraintException exception) {
            throw new NodeExecutor.Failure("HTTP_RESPONSE_TOO_LARGE",
                    "The HTTP response headers exceed the supported size.", false);
        } catch (java.net.SocketTimeoutException exception) {
            throw timeoutFailure();
        } catch (IOException exception) {
            if (deadlineExpired.get() || isTimeout(exception)) {
                throw timeoutFailure();
            }
            throw new NodeExecutor.Failure("HTTP_DEPENDENCY_UNAVAILABLE",
                    "The HTTP provider could not be reached.", true);
        } catch (NodeExecutor.Failure failure) {
            throw failure;
        } catch (RuntimeException exception) {
            if (deadlineExpired.get()) {
                throw timeoutFailure();
            }
            throw new NodeExecutor.Failure("HTTP_DEPENDENCY_UNAVAILABLE",
                    "The HTTP provider could not be reached.", true);
        }
    }

    private String normalizeMethod(String method) {
        if (method == null || method.isBlank()) {
            throw new NodeExecutor.Failure("HTTP_REQUEST_INVALID",
                    "The HTTP method is invalid.", false);
        }
        String normalized = method.toUpperCase(Locale.ROOT);
        if (!METHODS.contains(normalized)) {
            throw new NodeExecutor.Failure("HTTP_REQUEST_INVALID",
                    "The HTTP method is not supported.", false);
        }
        return normalized;
    }

    private Map<String, String> validateHeaders(Map<String, String> headers) {
        if (headers == null) {
            return Map.of();
        }
        long size = 0;
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            String name = entry.getKey();
            String value = entry.getValue();
            if (name == null || !HEADER_NAME.matcher(name).matches()
                    || FORBIDDEN_HEADERS.contains(name.toLowerCase(Locale.ROOT))
                    || value == null || value.isBlank()
                    || value.codePoints().anyMatch(codePoint -> codePoint < 0x20 || codePoint == 0x7f)) {
                throw new NodeExecutor.Failure("HTTP_REQUEST_INVALID",
                        "The HTTP headers are invalid.", false);
            }
            size += (long) name.length() + value.length() + 4;
            if (size > maxHeaderBytes) {
                throw new NodeExecutor.Failure("HTTP_REQUEST_TOO_LARGE",
                        "The HTTP headers exceed the supported size.", false);
            }
        }
        return Map.copyOf(headers);
    }

    private Map<String, String> validateAuthenticationHeaders(Map<String, String> headers) {
        if (headers == null) {
            return Map.of();
        }
        long size = 0;
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            String name = entry.getKey();
            String value = entry.getValue();
            String normalized = name == null ? "" : name.toLowerCase(Locale.ROOT);
            if (name == null || !HEADER_NAME.matcher(name).matches()
                    || !(normalized.equals("authorization") || normalized.equals("x-api-key"))
                    || value == null || value.isBlank()
                    || value.codePoints().anyMatch(codePoint -> codePoint < 0x20 || codePoint == 0x7f)) {
                throw new NodeExecutor.Failure("HTTP_REQUEST_INVALID",
                        "The HTTP authentication headers are invalid.", false);
            }
            size += (long) name.length() + value.length() + 4;
            if (size > maxHeaderBytes) {
                throw new NodeExecutor.Failure("HTTP_REQUEST_TOO_LARGE",
                        "The HTTP headers exceed the supported size.", false);
            }
        }
        return Map.copyOf(headers);
    }

    private Map<String, String> mergeHeaders(
            Map<String, String> userHeaders,
            Map<String, String> authenticationHeaders) {
        Map<String, String> merged = new java.util.LinkedHashMap<>(userHeaders);
        for (Map.Entry<String, String> entry : authenticationHeaders.entrySet()) {
            if (merged.keySet().stream().anyMatch(name -> name.equalsIgnoreCase(entry.getKey()))) {
                throw new NodeExecutor.Failure("HTTP_REQUEST_INVALID",
                        "The HTTP authentication headers are invalid.", false);
            }
            merged.put(entry.getKey(), entry.getValue());
        }
        long size = 0;
        for (Map.Entry<String, String> entry : merged.entrySet()) {
            size += (long) entry.getKey().length() + entry.getValue().length() + 4;
        }
        if (size > maxHeaderBytes) {
            throw new NodeExecutor.Failure("HTTP_REQUEST_TOO_LARGE",
                    "The HTTP headers exceed the supported size.", false);
        }
        return Map.copyOf(merged);
    }

    private byte[] serializeBody(Object body) {
        if (body == null) {
            return new byte[0];
        }
        BoundedByteArrayOutputStream output = new BoundedByteArrayOutputStream(maxRequestBytes);
        try {
            objectMapper.writeValue(output, body);
            return output.toByteArray();
        } catch (RuntimeException exception) {
            if (containsRequestTooLarge(exception)) {
                throw new NodeExecutor.Failure("HTTP_REQUEST_TOO_LARGE",
                        "The HTTP request body exceeds the supported size.", false);
            }
            throw new NodeExecutor.Failure("HTTP_REQUEST_INVALID",
                    "The HTTP request body is invalid.", false);
        }
    }

    private URI withQuery(URI original, Object query) {
        if (query == null) {
            return original;
        }
        if (!(query instanceof Map<?, ?> values)) {
            throw new NodeExecutor.Failure("HTTP_REQUEST_INVALID",
                    "The HTTP query must be an object.", false);
        }
        try {
            URIBuilder builder = new URIBuilder(original);
            for (Map.Entry<?, ?> entry : values.entrySet()) {
                if (!(entry.getKey() instanceof String key) || key.isBlank()) {
                    throw new IllegalArgumentException();
                }
                addQueryValue(builder, key, entry.getValue());
            }
            URI result = builder.build();
            if (result.toString().length() > maxRequestBytes) {
                throw new NodeExecutor.Failure("HTTP_REQUEST_TOO_LARGE",
                        "The HTTP request exceeds the supported size.", false);
            }
            return result;
        } catch (NodeExecutor.Failure failure) {
            throw failure;
        } catch (IllegalArgumentException | URISyntaxException exception) {
            throw new NodeExecutor.Failure("HTTP_REQUEST_INVALID",
                    "The HTTP query is invalid.", false);
        }
    }

    private void addQueryValue(URIBuilder builder, String key, Object value) {
        if (value instanceof Iterable<?> values) {
            for (Object item : values) {
                builder.addParameter(key, scalarQueryValue(item));
            }
            return;
        }
        builder.addParameter(key, scalarQueryValue(value));
    }

    private String scalarQueryValue(Object value) {
        if (value == null || value instanceof String || value instanceof Number || value instanceof Boolean) {
            return value == null ? "" : value.toString();
        }
        throw new NodeExecutor.Failure("HTTP_REQUEST_INVALID",
                "The HTTP query contains an unsupported value.", false);
    }

    private HeaderSnapshot readHeaders(Header[] headers, Set<String> activeSecrets) {
        java.util.LinkedHashMap<String, String> values = new java.util.LinkedHashMap<>();
        long size = 0;
        for (Header header : headers) {
            size += (long) header.getName().length() + header.getValue().length() + 4;
            if (size > maxHeaderBytes) {
                throw new ResponseTooLargeException();
            }
            Object sanitized = OutputSanitizer.sanitize(
                    Map.of(header.getName(), header.getValue()), activeSecrets);
            if (sanitized instanceof Map<?, ?> safeHeaders) {
                Object safeValue = safeHeaders.get(header.getName());
                if (safeValue instanceof String text) {
                    values.putIfAbsent(header.getName(), text);
                }
            }
        }
        return new HeaderSnapshot(Map.copyOf(values));
    }

    private void validateGoogleSheetsUri(URI uri) {
        if (uri == null
                || !uri.isAbsolute()
                || uri.getScheme() == null
                || !uri.getScheme().equalsIgnoreCase("https")
                || uri.getHost() == null
                || !uri.getHost().equalsIgnoreCase(GOOGLE_SHEETS_HOST)
                || (uri.getPort() != -1 && uri.getPort() != 443)
                || uri.getRawUserInfo() != null
                || uri.getRawFragment() != null
                || uri.getRawPath() == null
                || !uri.getRawPath().startsWith("/v4/spreadsheets/")) {
            throw new NodeExecutor.Failure("HTTP_REQUEST_INVALID",
                    "The Sheets destination is invalid.", false);
        }
    }

    private NodeExecutor.Failure timeoutFailure() {
        return new NodeExecutor.Failure("HTTP_TIMEOUT", "The HTTP request timed out.", true);
    }

    private boolean isTimeout(IOException exception) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            if (cause instanceof java.io.InterruptedIOException
                    || cause.getClass().getSimpleName().toLowerCase(Locale.ROOT).contains("timeout")) {
                return true;
            }
        }
        return false;
    }

    private boolean containsRequestTooLarge(Throwable exception) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            if (cause instanceof RequestTooLargeException) {
                return true;
            }
        }
        return false;
    }

    private static ScheduledThreadPoolExecutor createDeadlineExecutor() {
        AtomicInteger sequence = new AtomicInteger();
        ScheduledThreadPoolExecutor executor = new ScheduledThreadPoolExecutor(1, task -> {
            Thread thread = new Thread(task, "workflow-http-deadline-" + sequence.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        });
        executor.setRemoveOnCancelPolicy(true);
        return executor;
    }

    private byte[] readBounded(HttpEntity entity) throws IOException {
        long contentLength = entity.getContentLength();
        if (contentLength > maxResponseBytes) {
            throw new ResponseTooLargeException();
        }
        try (InputStream input = entity.getContent()) {
            ByteArrayOutputStream output = new ByteArrayOutputStream(
                    (int) Math.min(Math.max(contentLength, 0), maxResponseBytes));
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (read > maxResponseBytes - total) {
                    throw new ResponseTooLargeException();
                }
                output.write(buffer, 0, read);
                total += read;
            }
            return output.toByteArray();
        }
    }

    private Object decode(HttpEntity entity, byte[] bytes) {
        if (bytes.length == 0) {
            return "";
        }
        String contentType = entity == null ? null : entity.getContentType();
        if (contentType != null && contentType.toLowerCase(Locale.ROOT).contains("json")) {
            try {
                return objectMapper.readerFor(Object.class).readValue(bytes);
            } catch (RuntimeException ignored) {
                // A provider may send an invalid JSON error body; preserving it
                // as bounded text still lets the executor classify the status.
            }
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private static Duration positive(Duration value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        if (value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(name + " must be positive");
        }
        return value;
    }

    private static int positiveBytes(int value, String name) {
        if (value < 1) {
            throw new IllegalArgumentException(name + " must be positive");
        }
        return value;
    }

    private static final class BoundedByteArrayOutputStream extends ByteArrayOutputStream {

        private final int maximumBytes;

        private BoundedByteArrayOutputStream(int maximumBytes) {
            super(Math.min(maximumBytes, 8 * 1024));
            this.maximumBytes = maximumBytes;
        }

        @Override
        public synchronized void write(int value) {
            requireCapacity(1);
            super.write(value);
        }

        @Override
        public synchronized void write(byte[] bytes, int offset, int length) {
            requireCapacity(length);
            super.write(bytes, offset, length);
        }

        private void requireCapacity(int length) {
            if (length > maximumBytes - count) {
                throw new RequestTooLargeException();
            }
        }
    }

    private static final class RequestTooLargeException extends RuntimeException {
    }

    private static final class ResponseTooLargeException extends RuntimeException {
    }

    private record HeaderSnapshot(Map<String, String> values) {
    }

    private static final class InetAddressSet {
        private InetAddressSet() {
        }

        private static void install(
                InMemoryDnsResolver resolver,
                OutboundTargetPolicy.ApprovedTarget target) {
            List<java.net.InetAddress> addresses = target.addresses();
            java.net.InetAddress[] pinned = addresses.toArray(java.net.InetAddress[]::new);
            resolver.add(target.host(), pinned);
            String originalHost = target.original().getHost();
            if (originalHost != null && !originalHost.equals(target.host())) {
                resolver.add(originalHost, pinned);
            }
        }
    }

    public record HttpResponse(int status, Object data, Map<String, String> headers) {
        public HttpResponse {
            if (status < 100 || status > 599) {
                throw new IllegalArgumentException("status must be a valid HTTP status");
            }
            headers = headers == null ? Map.of() : Map.copyOf(headers);
        }
    }
}
