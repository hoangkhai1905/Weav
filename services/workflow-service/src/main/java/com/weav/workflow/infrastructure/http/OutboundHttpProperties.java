package com.weav.workflow.infrastructure.http;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Objects;

/**
 * Bounded settings for user supplied HTTP node calls.
 *
 * <p>The defaults are deliberately small enough for a workflow execution to
 * remain a bounded unit of work. Deployments can lower them further, but
 * values outside the validated range are rejected during application
 * startup.</p>
 */
@Component
@ConfigurationProperties(prefix = "weav.workflow.http")
public final class OutboundHttpProperties {

    public static final int DEFAULT_MAX_REQUEST_BYTES = 1_048_576;
    public static final int DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
    public static final int DEFAULT_MAX_HEADER_BYTES = 64 * 1024;

    private static final Duration MAX_TIMEOUT = Duration.ofMinutes(2);
    private static final int MAX_BODY_BYTES = 16 * 1024 * 1024;

    private Duration connectTimeout = Duration.ofSeconds(5);
    private Duration callTimeout = Duration.ofSeconds(30);
    private int maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES;
    private int maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES;
    private int maxHeaderBytes = DEFAULT_MAX_HEADER_BYTES;

    public OutboundHttpProperties() {
    }

    public OutboundHttpProperties(
            Duration connectTimeout,
            Duration callTimeout,
            int maxRequestBytes,
            int maxResponseBytes,
            int maxHeaderBytes) {
        setConnectTimeout(connectTimeout);
        setCallTimeout(callTimeout);
        setMaxRequestBytes(maxRequestBytes);
        setMaxResponseBytes(maxResponseBytes);
        setMaxHeaderBytes(maxHeaderBytes);
    }

    public Duration connectTimeout() {
        return connectTimeout;
    }

    public void setConnectTimeout(Duration connectTimeout) {
        this.connectTimeout = boundedTimeout(connectTimeout, "connectTimeout");
    }

    public Duration callTimeout() {
        return callTimeout;
    }

    public void setCallTimeout(Duration callTimeout) {
        this.callTimeout = boundedTimeout(callTimeout, "callTimeout");
    }

    public int maxRequestBytes() {
        return maxRequestBytes;
    }

    public void setMaxRequestBytes(int maxRequestBytes) {
        this.maxRequestBytes = boundedBytes(maxRequestBytes, "maxRequestBytes");
    }

    public int maxResponseBytes() {
        return maxResponseBytes;
    }

    public void setMaxResponseBytes(int maxResponseBytes) {
        this.maxResponseBytes = boundedBytes(maxResponseBytes, "maxResponseBytes");
    }

    public int maxHeaderBytes() {
        return maxHeaderBytes;
    }

    public void setMaxHeaderBytes(int maxHeaderBytes) {
        if (maxHeaderBytes < 1 || maxHeaderBytes > MAX_BODY_BYTES) {
            throw new IllegalArgumentException("maxHeaderBytes must be between one and 16 MiB");
        }
        this.maxHeaderBytes = maxHeaderBytes;
    }

    private static Duration boundedTimeout(Duration value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        if (value.isZero() || value.isNegative() || value.compareTo(MAX_TIMEOUT) > 0) {
            throw new IllegalArgumentException(name + " must be positive and at most two minutes");
        }
        return value;
    }

    private static int boundedBytes(int value, String name) {
        if (value < 1 || value > MAX_BODY_BYTES) {
            throw new IllegalArgumentException(name + " must be between one byte and 16 MiB");
        }
        return value;
    }
}
