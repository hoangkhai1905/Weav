package com.weav.workspace.infrastructure.provider.http;

import com.weav.workspace.domain.exception.DependencyUnavailableException;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.InMemoryDnsResolver;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.CloseableHttpResponse;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.apache.hc.core5.http.HttpEntity;
import org.apache.hc.core5.util.Timeout;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * One-shot bounded GET transport for already validated targets.
 *
 * <p>Each request receives a resolver containing only the addresses returned
 * by {@link HttpTargetValidator}. Redirects, retries, compression, and
 * unbounded response buffering are disabled.</p>
 */
public final class PinnedHttpTransport {

    public static final int MAX_RESPONSE_BODY_BYTES = 64 * 1024;

    private final Duration connectTimeout;
    private final Duration readTimeout;

    public PinnedHttpTransport() {
        this(Duration.ofSeconds(3), Duration.ofSeconds(5));
    }

    public PinnedHttpTransport(Duration connectTimeout, Duration readTimeout) {
        this.connectTimeout = positive(connectTimeout, "connectTimeout");
        this.readTimeout = positive(readTimeout, "readTimeout");
    }

    public Response get(
            HttpTargetValidator.ValidatedTarget target,
            Map<String, String> headers) {
        Objects.requireNonNull(target, "target must not be null");
        Objects.requireNonNull(headers, "headers must not be null");

        InMemoryDnsResolver resolver = new InMemoryDnsResolver();
        List<InetAddress> addresses = target.addresses();
        InetAddress[] pinnedAddresses = addresses.toArray(InetAddress[]::new);
        resolver.add(target.host(), pinnedAddresses);
        String uriHost = target.uri().getHost();
        if (uriHost != null && !uriHost.equals(target.host())) {
            resolver.add(uriHost, pinnedAddresses);
        }

        RequestConfig requestConfig = RequestConfig.custom()
                .setConnectTimeout(Timeout.of(connectTimeout))
                .setResponseTimeout(Timeout.of(readTimeout))
                .setConnectionRequestTimeout(Timeout.of(connectTimeout))
                .setRedirectsEnabled(false)
                .build();
        var manager = PoolingHttpClientConnectionManagerBuilder.create()
                .setDnsResolver(resolver)
                .setMaxConnTotal(1)
                .setMaxConnPerRoute(1)
                .build();

        try (CloseableHttpClient client = HttpClients.custom()
                .setConnectionManager(manager)
                .setDefaultRequestConfig(requestConfig)
                .disableRedirectHandling()
                .disableAutomaticRetries()
                .disableContentCompression()
                .build()) {
            HttpGet request = new HttpGet(target.uri());
            request.setHeader("Connection", "close");
            headers.forEach(request::setHeader);
            try (CloseableHttpResponse response = client.execute(request)) {
                byte[] body = response.getEntity() == null
                        ? new byte[0]
                        : readBounded(response.getEntity());
                return new Response(response.getCode(), body);
            }
        } catch (IOException | RuntimeException exception) {
            // Do not preserve the cause: Apache diagnostics can contain a
            // request URI or header value. Callers receive only the stable,
            // secret-free dependency classification.
            throw new DependencyUnavailableException();
        }
    }

    private static byte[] readBounded(HttpEntity entity) throws IOException {
        long contentLength = entity.getContentLength();
        if (contentLength > MAX_RESPONSE_BODY_BYTES) {
            throw new IOException("response body exceeded configured limit");
        }
        try (InputStream input = entity.getContent()) {
            ByteArrayOutputStream output = new ByteArrayOutputStream(
                    (int) Math.min(Math.max(contentLength, 0), MAX_RESPONSE_BODY_BYTES));
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (read > MAX_RESPONSE_BODY_BYTES - total) {
                    throw new IOException("response body exceeded configured limit");
                }
                output.write(buffer, 0, read);
                total += read;
            }
            return output.toByteArray();
        }
    }

    private static Duration positive(Duration value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        if (value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(name + " must be positive");
        }
        return value;
    }

    public record Response(int statusCode, byte[] body) {
        public Response {
            if (statusCode < 100 || statusCode > 599) {
                throw new IllegalArgumentException("statusCode must be a valid HTTP status");
            }
            Objects.requireNonNull(body, "body must not be null");
            body = body.clone();
        }

        @Override
        public byte[] body() {
            return body.clone();
        }
    }
}
