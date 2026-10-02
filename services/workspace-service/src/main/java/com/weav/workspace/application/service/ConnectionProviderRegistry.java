package com.weav.workspace.application.service;

import com.weav.workspace.application.port.out.ConnectionProviderPort;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.valueobject.ConnectionProvider;

import java.util.Arrays;
import java.util.EnumMap;
import java.util.Map;
import java.util.Objects;

/**
 * Small, explicitly wired V1 provider registry.
 *
 * <p>This is intentionally a fixed map. It does not discover classes,
 * consult the database, or act as a plugin framework.</p>
 */
public final class ConnectionProviderRegistry {

    private final Map<ConnectionProvider, ConnectionProviderPort> providers;

    public ConnectionProviderRegistry(ConnectionProviderPort... providerPorts) {
        Objects.requireNonNull(providerPorts, "providerPorts must not be null");
        EnumMap<ConnectionProvider, ConnectionProviderPort> resolved =
                new EnumMap<>(ConnectionProvider.class);
        Arrays.stream(providerPorts)
                .map(port -> Objects.requireNonNull(port, "provider port must not be null"))
                .forEach(port -> {
                    ConnectionProvider provider = Objects.requireNonNull(
                            port.provider(), "provider port provider must not be null");
                    if (resolved.putIfAbsent(provider, port) != null) {
                        throw new IllegalArgumentException("Duplicate connection provider");
                    }
                });
        this.providers = Map.copyOf(resolved);
    }

    public ConnectionProviderPort resolve(ConnectionProvider provider) {
        if (provider == null) {
            throw new BadRequestException("Connection provider is not supported");
        }
        ConnectionProviderPort resolved = providers.get(provider);
        if (resolved == null) {
            throw new BadRequestException("Connection provider is not supported");
        }
        return resolved;
    }
}
