package com.weav.workspace.application.service;

import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;

import java.util.Map;
import java.util.Objects;
import java.util.Set;

public final class ConnectionProviderPolicy {

    private static final Map<ConnectionProvider, Set<ConnectionAuthType>> ALLOWED_AUTH_TYPES = Map.ofEntries(
            Map.entry(ConnectionProvider.GMAIL, Set.of(ConnectionAuthType.OAUTH2)),
            Map.entry(ConnectionProvider.GOOGLE_SHEETS, Set.of(ConnectionAuthType.OAUTH2)),
            Map.entry(ConnectionProvider.GOOGLE_CALENDAR, Set.of(ConnectionAuthType.OAUTH2)),
            Map.entry(ConnectionProvider.GOOGLE_DRIVE, Set.of(ConnectionAuthType.OAUTH2)),
            Map.entry(ConnectionProvider.TELEGRAM, Set.of(ConnectionAuthType.TOKEN)),
            Map.entry(ConnectionProvider.DISCORD, Set.of(ConnectionAuthType.TOKEN)),
            Map.entry(ConnectionProvider.SLACK, Set.of(ConnectionAuthType.TOKEN)),
            Map.entry(ConnectionProvider.TEAMS, Set.of(ConnectionAuthType.TOKEN)),
            Map.entry(ConnectionProvider.OPENAI, Set.of(ConnectionAuthType.TOKEN)),
            Map.entry(ConnectionProvider.ANTHROPIC, Set.of(ConnectionAuthType.TOKEN)),
            Map.entry(ConnectionProvider.GEMINI, Set.of(ConnectionAuthType.TOKEN)),
            Map.entry(ConnectionProvider.HTTP, Set.of(
                    ConnectionAuthType.NONE,
                    ConnectionAuthType.API_KEY,
                    ConnectionAuthType.TOKEN,
                    ConnectionAuthType.BASIC)));

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
