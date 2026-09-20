package com.weav.workspace.infrastructure.provider.google;

import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.port.out.ConnectionProviderPort;
import com.weav.workspace.application.port.out.GoogleOAuthPort;
import com.weav.workspace.application.service.GoogleOAuthScopePolicy;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;

import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Google OAuth-backed verification adapter for one registered Google provider. */
public final class GoogleConnectionProvider implements ConnectionProviderPort {

    private static final int MAX_TOKEN_LENGTH = 16 * 1024;

    private final ConnectionProvider provider;
    private final GoogleOAuthPort googleOAuthPort;
    private final GoogleOAuthScopePolicy scopePolicy;

    public GoogleConnectionProvider(
            ConnectionProvider provider,
            GoogleOAuthPort googleOAuthPort,
            GoogleOAuthScopePolicy scopePolicy) {
        if (provider != ConnectionProvider.GMAIL && provider != ConnectionProvider.GOOGLE_SHEETS) {
            throw new IllegalArgumentException("Google connection provider is not supported");
        }
        this.provider = provider;
        this.googleOAuthPort = Objects.requireNonNull(googleOAuthPort, "googleOAuthPort must not be null");
        this.scopePolicy = Objects.requireNonNull(scopePolicy, "scopePolicy must not be null");
    }

    @Override
    public ConnectionProvider provider() {
        return provider;
    }

    @Override
    public void validateConfig(ConnectionAuthType authType, Map<String, Object> config) {
        if (authType != ConnectionAuthType.OAUTH2 || (config != null && !config.isEmpty())) {
            throw new BadRequestException("Google connection configuration is invalid");
        }
    }

    @Override
    public ConnectionTestResult test(Connection connection, Map<String, Object> decryptedCredential) {
        Objects.requireNonNull(connection, "connection must not be null");
        if (connection.getProvider() != provider) {
            throw new BadRequestException("Google connection configuration is invalid");
        }
        validateConfig(connection.getAuthType(), connection.getConfig());
        if (!validCredential(decryptedCredential)) {
            return ConnectionTestResult.authInvalid();
        }

        String accessToken = (String) decryptedCredential.get("accessToken");
        @SuppressWarnings("unchecked")
        List<String> grantedScopes = (List<String>) decryptedCredential.get("grantedScopes");
        if (!scopePolicy.containsRequiredScopes(provider, grantedScopes)) {
            return ConnectionTestResult.authInvalid();
        }
        ConnectionTestResult result = googleOAuthPort.verify(provider, accessToken, grantedScopes);
        if (result == null || result.outcome() == null) {
            throw new DependencyUnavailableException();
        }
        return result;
    }

    private boolean validCredential(Map<String, Object> credential) {
        if (credential == null || credential.size() != 4
                || !credential.keySet().equals(java.util.Set.of(
                "accessToken", "refreshToken", "tokenType", "grantedScopes"))) {
            return false;
        }
        return isToken(credential.get("accessToken"))
                && isToken(credential.get("refreshToken"))
                && "Bearer".equals(credential.get("tokenType"))
                && credential.get("grantedScopes") instanceof List<?> scopes
                && !scopes.isEmpty()
                && scopes.stream().allMatch(scope -> scope instanceof String text
                && !text.isBlank() && text.length() <= 1024
                && text.codePoints().noneMatch(Character::isISOControl));
    }

    private boolean isToken(Object value) {
        return value instanceof String token
                && !token.isBlank()
                && token.length() <= MAX_TOKEN_LENGTH
                && token.codePoints().noneMatch(Character::isISOControl);
    }
}
