package com.weav.workspace.application.service;

import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;

import java.util.Map;
import java.util.Objects;
import java.util.Set;

public final class ConnectionProviderPolicy {

    private static final Map<ConnectionProvider, Set<ConnectionAuthType>> ALLOWED_AUTH_TYPES = Map.of(
            ConnectionProvider.GMAIL, Set.of(ConnectionAuthType.OAUTH2),
            ConnectionProvider.GOOGLE_SHEETS, Set.of(ConnectionAuthType.OAUTH2),
            ConnectionProvider.TELEGRAM, Set.of(ConnectionAuthType.TOKEN),
            ConnectionProvider.HTTP, Set.of(
                    ConnectionAuthType.NONE,
                    ConnectionAuthType.API_KEY,
                    ConnectionAuthType.TOKEN,
                    ConnectionAuthType.BASIC));

    public void validate(ConnectionProvider provider, ConnectionAuthType authType) {
        if (provider == null || authType == null
                || !ALLOWED_AUTH_TYPES.getOrDefault(provider, Set.of()).contains(authType)) {
            throw new BadRequestException("Unsupported connection provider/auth type combination");
        }
    }

    public boolean requiresCredential(ConnectionAuthType authType) {
        Objects.requireNonNull(authType, "authType must not be null");
        return authType != ConnectionAuthType.NONE;
    }
}
