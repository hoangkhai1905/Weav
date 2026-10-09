package com.weav.workspace.infrastructure.provider.discord;

import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.port.out.ConnectionProviderPort;
import com.weav.workspace.application.service.CredentialPayloadCodec;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.infrastructure.provider.http.HttpTargetValidator;
import com.weav.workspace.infrastructure.provider.http.PinnedHttpTransport;

import java.net.URI;
import java.util.Map;
import java.util.Objects;

/**
 * DISCORD TOKEN verification: the secret is a webhook URL, and a GET on it returns the webhook's
 * metadata without posting a message. The URL is never logged or included in a result.
 */
public final class DiscordConnectionProvider implements ConnectionProviderPort {

    private final HttpTargetValidator targetValidator;
    private final PinnedHttpTransport transport;

    public DiscordConnectionProvider(HttpTargetValidator targetValidator, PinnedHttpTransport transport) {
        this.targetValidator = Objects.requireNonNull(targetValidator, "targetValidator must not be null");
        this.transport = Objects.requireNonNull(transport, "transport must not be null");
    }

    @Override
    public ConnectionProvider provider() {
        return ConnectionProvider.DISCORD;
    }

    @Override
    public void validateConfig(ConnectionAuthType authType, Map<String, Object> config) {
        if (authType != ConnectionAuthType.TOKEN || (config != null && !config.isEmpty())) {
            throw new BadRequestException("Discord connection configuration is invalid");
        }
    }

    @Override
    public ConnectionTestResult test(Connection connection, Map<String, Object> decryptedCredential) {
        Objects.requireNonNull(connection, "connection must not be null");
        if (connection.getProvider() != ConnectionProvider.DISCORD) {
            throw new BadRequestException("Discord connection configuration is invalid");
        }
        validateConfig(connection.getAuthType(), connection.getConfig());
        if (decryptedCredential == null
                || decryptedCredential.size() != 1
                || !(decryptedCredential.get("token") instanceof String url)
                || !CredentialPayloadCodec.DISCORD_WEBHOOK_URL.matcher(url).matches()) {
            return ConnectionTestResult.authInvalid();
        }
        try {
            HttpTargetValidator.ValidatedTarget validated = targetValidator.validateAndResolve(URI.create(url));
            return classify(transport.get(validated, Map.of()).statusCode());
        } catch (DependencyUnavailableException exception) {
            return ConnectionTestResult.dependencyFailure();
        }
    }

    static ConnectionTestResult classify(int statusCode) {
        if (statusCode >= 200 && statusCode < 300) {
            return ConnectionTestResult.verified();
        }
        if (statusCode == 401 || statusCode == 404) {
            return ConnectionTestResult.authInvalid();
        }
        return ConnectionTestResult.dependencyFailure();
    }
}
