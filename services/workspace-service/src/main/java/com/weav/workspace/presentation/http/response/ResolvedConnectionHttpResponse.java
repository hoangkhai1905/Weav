package com.weav.workspace.presentation.http.response;

import com.weav.workspace.application.dto.ResolvedConnectionCredential;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;

import java.util.Map;
import java.util.Objects;

/** Minimal internal runtime credential. Google refresh tokens are never present. */
public record ResolvedConnectionHttpResponse(
        ConnectionProvider provider,
        ConnectionAuthType authType,
        Map<String, String> auth) {

    public ResolvedConnectionHttpResponse {
        Objects.requireNonNull(provider, "provider must not be null");
        Objects.requireNonNull(authType, "authType must not be null");
        auth = Map.copyOf(Objects.requireNonNull(auth, "auth must not be null"));
    }

    public static ResolvedConnectionHttpResponse from(ResolvedConnectionCredential credential) {
        return new ResolvedConnectionHttpResponse(
                credential.provider(), credential.authType(), credential.auth());
    }

    @Override
    public String toString() {
        return "ResolvedConnectionHttpResponse[provider=" + provider
                + ", authType=" + authType + ", auth=<redacted>]";
    }
}
