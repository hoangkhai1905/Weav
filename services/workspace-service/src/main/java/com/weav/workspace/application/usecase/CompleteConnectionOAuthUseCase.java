package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.dto.GoogleOAuthCallbackResult;
import com.weav.workspace.application.dto.GoogleOAuthTokenResponse;
import com.weav.workspace.application.dto.OAuthPendingState;
import com.weav.workspace.application.port.out.ConnectionProviderPort;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.GoogleOAuthPort;
import com.weav.workspace.application.port.out.OAuthStateStore;
import com.weav.workspace.application.service.ConnectionProviderRegistry;
import com.weav.workspace.application.service.ConnectionUsageProtection;
import com.weav.workspace.application.service.CredentialPayloadCodec;
import com.weav.workspace.application.service.GoogleOAuthScopePolicy;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.DomainException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Credential;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.TransactionException;

import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Consumes one OAuth state, verifies Google, then atomically persists the encrypted credential/status. */
@Service
public final class CompleteConnectionOAuthUseCase {

    private static final int MAX_AUTHORIZATION_CODE_LENGTH = 8192;

    private final ConnectionRepository connectionRepository;
    private final CredentialRepository credentialRepository;
    private final ConnectionUsageProtection usageProtection;
    private final OAuthStateStore stateStore;
    private final GoogleOAuthPort googleOAuthPort;
    private final GoogleOAuthScopePolicy scopePolicy;
    private final ConnectionProviderRegistry providerRegistry;
    private final CredentialPayloadCodec payloadCodec;
    private final CredentialCryptoPort crypto;
    private final Clock clock;

    public CompleteConnectionOAuthUseCase(
            ConnectionRepository connectionRepository,
            CredentialRepository credentialRepository,
            ConnectionUsageProtection usageProtection,
            OAuthStateStore stateStore,
            GoogleOAuthPort googleOAuthPort,
            GoogleOAuthScopePolicy scopePolicy,
            ConnectionProviderRegistry providerRegistry,
            CredentialPayloadCodec payloadCodec,
            CredentialCryptoPort crypto,
            Clock clock) {
        this.connectionRepository = Objects.requireNonNull(
                connectionRepository, "connectionRepository must not be null");
        this.credentialRepository = Objects.requireNonNull(
                credentialRepository, "credentialRepository must not be null");
        this.usageProtection = Objects.requireNonNull(usageProtection, "usageProtection must not be null");
        this.stateStore = Objects.requireNonNull(stateStore, "stateStore must not be null");
        this.googleOAuthPort = Objects.requireNonNull(googleOAuthPort, "googleOAuthPort must not be null");
        this.scopePolicy = Objects.requireNonNull(scopePolicy, "scopePolicy must not be null");
        this.providerRegistry = Objects.requireNonNull(providerRegistry, "providerRegistry must not be null");
        this.payloadCodec = Objects.requireNonNull(payloadCodec, "payloadCodec must not be null");
        this.crypto = Objects.requireNonNull(crypto, "crypto must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    public ConnectionTestResult execute(String state, String authorizationCode) {
        return execute(state, authorizationCode, null);
    }

    /** The callback error is handled only after state consumption and is never reflected to the client. */
    public ConnectionTestResult execute(String state, String authorizationCode, String callbackError) {
        OAuthPendingState pendingState = stateStore.consume(state)
                .orElseThrow(() -> new BadRequestException("Google authorization state is invalid or expired"));
        return executePending(pendingState, authorizationCode, callbackError, null);
    }

    /**
     * Consumes the callback state exactly once and returns only safe redirect data.
     * The connection id is trusted only after it has been recovered from that state.
     */
    public GoogleOAuthCallbackResult executeForCallback(
            String state,
            String authorizationCode,
            String callbackError) {
        final OAuthPendingState pendingState;
        try {
            pendingState = stateStore.consume(state).orElse(null);
        } catch (DependencyUnavailableException exception) {
            // Redis is the only state authority. Without it there is no trusted
            // connection id and the callback must fail closed.
            return GoogleOAuthCallbackResult.failure(
                    null, GoogleOAuthCallbackResult.FailureReason.STATE_INVALID);
        }
        if (pendingState == null) {
            return GoogleOAuthCallbackResult.failure(
                    null, GoogleOAuthCallbackResult.FailureReason.STATE_INVALID);
        }

        UUID connectionId = pendingState.connectionId();
        if (callbackError != null && !callbackError.isBlank()) {
            return GoogleOAuthCallbackResult.failure(
                    connectionId, GoogleOAuthCallbackResult.FailureReason.AUTHORIZATION_DENIED);
        }
        if (!isValidAuthorizationCode(authorizationCode)) {
            return GoogleOAuthCallbackResult.failure(
                    connectionId, GoogleOAuthCallbackResult.FailureReason.TOKEN_EXCHANGE_FAILED);
        }

        CallbackStageTracker stage = new CallbackStageTracker();
        try {
            ConnectionTestResult verification = executePending(
                    pendingState, authorizationCode, null, stage);
            if (verification == null || verification.outcome() == null
                    || verification.outcome() != ConnectionTestResult.ConnectionTestOutcome.VERIFIED) {
                return GoogleOAuthCallbackResult.failure(
                        connectionId, GoogleOAuthCallbackResult.FailureReason.VERIFICATION_FAILED);
            }
            return GoogleOAuthCallbackResult.success(connectionId);
        } catch (DomainException exception) {
            // Application failures are reduced to an allow-listed reason; provider,
            // database, and callback details never reach the redirect.
            return GoogleOAuthCallbackResult.failure(connectionId, stage.failureReason());
        } catch (DataAccessException | TransactionException exception) {
            // Repository and transaction failures can happen after state is consumed,
            // including at transaction commit. Keep callback behavior safe without
            // reporting success or exposing infrastructure diagnostics.
            return GoogleOAuthCallbackResult.failure(connectionId, stage.failureReason());
        }
    }

    private ConnectionTestResult executePending(
            OAuthPendingState pendingState,
            String authorizationCode,
            String callbackError,
            CallbackStageTracker callbackStage) {
        if (callbackError != null && !callbackError.isBlank()) {
            if ("access_denied".equals(callbackError)) {
                throw new BadRequestException("Google authorization was denied");
            }
            throw new BadRequestException("Google authorization did not complete");
        }
        if (!isValidAuthorizationCode(authorizationCode)) {
            throw new BadRequestException("Google authorization response is invalid");
        }

        advance(callbackStage, GoogleOAuthCallbackResult.FailureReason.AUTHORIZATION_CHANGED);
        ConnectionProvider provider = pendingState.provider();
        ConnectionUsageProtection.Authorization initialAuthorization = usageProtection.authorize(
                pendingState.userId(), pendingState.workspaceId(), pendingState.connectionId());
        Connection connection = loadAndValidateConnection(pendingState);
        ConnectionProviderPort googleProvider = providerRegistry.resolve(provider);
        googleProvider.validateConfig(connection.getAuthType(), connection.getConfig());
        usageProtection.requireUnused(
                initialAuthorization, ConnectionUsageProtection.UsageScope.MEMBER_ONLY);

        advance(callbackStage, GoogleOAuthCallbackResult.FailureReason.TOKEN_EXCHANGE_FAILED);
        GoogleOAuthTokenResponse tokens = googleOAuthPort.exchangeAuthorizationCode(authorizationCode);
        Instant accessTokenExpiresAt = clock.instant().plusSeconds(tokens.expiresInSeconds());
        advance(callbackStage, GoogleOAuthCallbackResult.FailureReason.VERIFICATION_FAILED);
        scopePolicy.requireRequiredScopes(provider, tokens.grantedScopes());
        Map<String, Object> credentialPayload = credentialPayload(tokens);
        ConnectionTestResult verification = googleProvider.test(connection, credentialPayload);
        if (verification == null || verification.outcome() == null
                || verification.outcome() == ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE) {
            throw new DependencyUnavailableException();
        }
        if (verification.outcome() == ConnectionTestResult.ConnectionTestOutcome.VERIFIED
                && !accessTokenExpiresAt.isAfter(clock.instant())) {
            throw new DependencyUnavailableException();
        }

        // The exchange and Google verification were remote calls. Recheck live membership and
        // usage before entering the short transaction that writes the credential/status.
        advance(callbackStage, GoogleOAuthCallbackResult.FailureReason.AUTHORIZATION_CHANGED);
        ConnectionUsageProtection.Authorization finalAuthorization = usageProtection.authorize(
                pendingState.userId(), pendingState.workspaceId(), pendingState.connectionId());
        usageProtection.requireUnused(
                finalAuthorization, ConnectionUsageProtection.UsageScope.MEMBER_ONLY);

        final byte[] encryptedCredential;
        final String encryptionKeyVersion;
        if (verification.outcome() == ConnectionTestResult.ConnectionTestOutcome.VERIFIED) {
            advance(callbackStage, GoogleOAuthCallbackResult.FailureReason.VERIFICATION_FAILED);
            try {
                encryptedCredential = crypto.encrypt(payloadCodec.encodeGoogleOAuth(connection, tokens));
                encryptionKeyVersion = crypto.currentKeyVersion();
            } catch (RuntimeException exception) {
                // Crypto diagnostics must never carry the in-memory OAuth payload to an error boundary.
                throw new DependencyUnavailableException();
            }
        } else {
            encryptedCredential = null;
            encryptionKeyVersion = null;
        }

        advance(callbackStage, GoogleOAuthCallbackResult.FailureReason.AUTHORIZATION_CHANGED);
        return usageProtection.reauthorizeAndMutate(
                pendingState.userId(),
                pendingState.workspaceId(),
                pendingState.connectionId(),
                finalAuthorization,
                ConnectionUsageProtection.UsageScope.MEMBER_ONLY,
                (membership, currentConnection) -> {
                    validatePendingConnection(pendingState, currentConnection);
                    if (verification.outcome() == ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID) {
                        currentConnection.markInvalid();
                        connectionRepository.save(currentConnection);
                        return verification;
                    }

                    Credential currentCredential = credentialRepository
                            .findByConnectionId(currentConnection.getId()).orElse(null);
                    Instant now = clock.instant();
                    if (!accessTokenExpiresAt.isAfter(now)) {
                        throw new DependencyUnavailableException();
                    }
                    Credential replacement = currentCredential == null
                            ? new Credential(
                                    UUID.randomUUID(),
                                    currentConnection.getId(),
                                    encryptedCredential,
                                    encryptionKeyVersion,
                                    accessTokenExpiresAt,
                                    now,
                                    now)
                            : new Credential(
                                    currentCredential.getId(),
                                    currentConnection.getId(),
                                    encryptedCredential,
                                    encryptionKeyVersion,
                                    accessTokenExpiresAt,
                                    currentCredential.getCreatedAt(),
                                    now);
                    credentialRepository.save(replacement);
                    currentConnection.markVerified(now);
                    connectionRepository.save(currentConnection);
                    return verification;
                });
    }

    private void advance(
            CallbackStageTracker callbackStage,
            GoogleOAuthCallbackResult.FailureReason failureReason) {
        if (callbackStage != null) {
            callbackStage.failureReason = failureReason;
        }
    }

    private Connection loadAndValidateConnection(OAuthPendingState pendingState) {
        Connection connection = connectionRepository
                .findByWorkspaceIdAndId(pendingState.workspaceId(), pendingState.connectionId())
                .orElseThrow(() -> new ResourceNotFoundException("Connection not found", pendingState.connectionId()));
        validatePendingConnection(pendingState, connection);
        return connection;
    }

    private void validatePendingConnection(OAuthPendingState pendingState, Connection connection) {
        ConnectionProvider provider = pendingState.provider();
        if (!pendingState.workspaceId().equals(connection.getWorkspaceId())
                || !pendingState.connectionId().equals(connection.getId())
                || provider != connection.getProvider()
                || connection.getAuthType() != ConnectionAuthType.OAUTH2
                || (provider != ConnectionProvider.GMAIL && provider != ConnectionProvider.GOOGLE_SHEETS)
                || (connection.getConfig() != null && !connection.getConfig().isEmpty())) {
            throw new BadRequestException("Google authorization state does not match the connection");
        }
    }

    private Map<String, Object> credentialPayload(GoogleOAuthTokenResponse tokens) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("accessToken", tokens.accessToken());
        payload.put("refreshToken", tokens.refreshToken());
        payload.put("tokenType", tokens.tokenType());
        payload.put("grantedScopes", List.copyOf(tokens.grantedScopes()));
        return Map.copyOf(payload);
    }

    private boolean isValidAuthorizationCode(String code) {
        return code != null && !code.isBlank() && code.length() <= MAX_AUTHORIZATION_CODE_LENGTH
                && code.codePoints().noneMatch(Character::isISOControl);
    }

    private static final class CallbackStageTracker {

        private GoogleOAuthCallbackResult.FailureReason failureReason =
                GoogleOAuthCallbackResult.FailureReason.AUTHORIZATION_CHANGED;

        private GoogleOAuthCallbackResult.FailureReason failureReason() {
            return failureReason;
        }
    }
}
