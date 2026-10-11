package com.weav.workspace.infrastructure.provider.teams;

import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.port.out.ConnectionProviderPort;
import com.weav.workspace.application.service.CredentialPayloadCodec;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;

import java.util.Map;
import java.util.Objects;

/**
 * TEAMS TOKEN verification: the secret is a webhook URL. A TEAMS webhook only accepts POSTs that
 * deliver a message, so the test is a shape check on the stored URL and sends nothing. The URL is
 * never logged or included in a result.
 */
public final class TeamsConnectionProvider implements ConnectionProviderPort {

    @Override
    public ConnectionProvider provider() {
        return ConnectionProvider.TEAMS;
    }

    @Override
    public void validateConfig(ConnectionAuthType authType, Map<String, Object> config) {
        if (authType != ConnectionAuthType.TOKEN || (config != null && !config.isEmpty())) {
            throw new BadRequestException("Teams connection configuration is invalid");
        }
    }

    @Override
    public ConnectionTestResult test(Connection connection, Map<String, Object> decryptedCredential) {
        Objects.requireNonNull(connection, "connection must not be null");
        if (connection.getProvider() != ConnectionProvider.TEAMS) {
            throw new BadRequestException("Teams connection configuration is invalid");
        }
        validateConfig(connection.getAuthType(), connection.getConfig());
        if (decryptedCredential == null
                || decryptedCredential.size() != 1
                || !(decryptedCredential.get("token") instanceof String url)
                || !CredentialPayloadCodec.isTeamsWebhookUrl(url)) {
            return ConnectionTestResult.authInvalid();
        }
        return ConnectionTestResult.verified();
    }
}
