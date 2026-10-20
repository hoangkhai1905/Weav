package com.weav.workspace.infrastructure.provider.llm;

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
 * Checks a workspace-owned OpenAI, Anthropic or Gemini API key by listing models.
 * The key is only ever placed in a request header; it is never part of a URL,
 * exception message or log line.
 */
public final class LlmKeyConnectionProvider implements ConnectionProviderPort {

    private final ConnectionProvider provider;
    private final URI modelsUrl;
    private final HttpTargetValidator targetValidator;
    private final PinnedHttpTransport transport;

    public LlmKeyConnectionProvider(
            ConnectionProvider provider,
            URI modelsUrl,
            HttpTargetValidator targetValidator,
            PinnedHttpTransport transport) {
        this.provider = Objects.requireNonNull(provider, "provider must not be null");
        if (!provider.isLlmKey()) {
            throw new IllegalArgumentException("Not an AI key provider");
        }
        this.modelsUrl = Objects.requireNonNull(modelsUrl, "modelsUrl must not be null");
        this.targetValidator = Objects.requireNonNull(targetValidator, "targetValidator must not be null");
        this.transport = Objects.requireNonNull(transport, "transport must not be null");
        targetValidator.validateUriShape(modelsUrl);
    }

    @Override
    public ConnectionProvider provider() {
        return provider;
    }

    @Override
    public void validateConfig(ConnectionAuthType authType, Map<String, Object> config) {
        if (authType != ConnectionAuthType.TOKEN || (config != null && !config.isEmpty())) {
            throw new BadRequestException("AI connection configuration is invalid");
        }
    }

    @Override
    public ConnectionTestResult test(Connection connection, Map<String, Object> decryptedCredential) {
        Objects.requireNonNull(connection, "connection must not be null");
        if (connection.getProvider() != provider) {
            throw new BadRequestException("AI connection configuration is invalid");
        }
        validateConfig(connection.getAuthType(), connection.getConfig());
        if (decryptedCredential == null
                || decryptedCredential.size() != 1
                || !(decryptedCredential.get("token") instanceof String key)
                || key.isEmpty()
                || !CredentialPayloadCodec.isLlmApiKey(key)) {
            return ConnectionTestResult.authInvalid();
        }
        try {
            HttpTargetValidator.ValidatedTarget validated = targetValidator.validateAndResolve(modelsUrl);
            int status = transport.get(validated, headers(key)).statusCode();
            if (status >= 200 && status < 300) {
                return ConnectionTestResult.verified();
            }
            // 400 included: Gemini answers 400 for a malformed key.
            if (status == 400 || status == 401 || status == 403) {
                return ConnectionTestResult.authInvalid();
            }
            return ConnectionTestResult.dependencyFailure();
        } catch (DependencyUnavailableException exception) {
            return ConnectionTestResult.dependencyFailure();
        }
    }

    private Map<String, String> headers(String key) {
        if (provider == ConnectionProvider.ANTHROPIC) {
            return Map.of("x-api-key", key, "anthropic-version", "2023-06-01");
        }
        return Map.of("Authorization", "Bearer " + key);
    }
}
