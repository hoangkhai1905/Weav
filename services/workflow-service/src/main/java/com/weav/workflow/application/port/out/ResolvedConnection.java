package com.weav.workflow.application.port.out;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Short-lived, non-serializable Workspace credential holder. Closing it
 * discards its credential references; callers must not retain credential
 * values after use.
 */
public final class ResolvedConnection implements AutoCloseable {

    private final String provider;
    private final String authType;
    private final Map<String, String> credentials;
    private final Map<String, String> credentialView;
    private boolean closed;

    public ResolvedConnection(String provider, String authType, Map<String, String> auth) {
        if (provider == null || provider.isBlank()) {
            throw new IllegalArgumentException("provider must not be blank");
        }
        if (authType == null || authType.isBlank()) {
            throw new IllegalArgumentException("authType must not be blank");
        }
        this.provider = provider;
        this.authType = authType;
        this.credentials = new LinkedHashMap<>(Objects.requireNonNull(auth, "auth must not be null"));
        this.credentials.forEach((key, value) -> {
            if (key == null || key.isBlank() || value == null || value.isBlank()) {
                throw new IllegalArgumentException("auth fields must contain non-blank values");
            }
        });
        this.credentialView = Collections.unmodifiableMap(credentials);
    }

    public String provider() {
        return provider;
    }

    public String authType() {
        return authType;
    }

    public Map<String, String> auth() {
        if (closed) {
            throw new IllegalStateException("resolved connection is closed");
        }
        return credentialView;
    }

    @Override
    public void close() {
        if (!closed) {
            credentials.clear();
            closed = true;
        }
    }

    @Override
    public String toString() {
        return "ResolvedConnection[provider=" + provider
                + ", authType=" + authType
                + ", auth=<redacted>]";
    }
}
