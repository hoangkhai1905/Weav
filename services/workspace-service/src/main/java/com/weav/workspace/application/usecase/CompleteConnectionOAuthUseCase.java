package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.dto.GoogleOAuthCallbackResult;
import com.weav.workspace.application.dto.GoogleOAuthTokenResponse;
import com.weav.workspace.application.dto.OAuthPendingState;
import com.weav.workspace.application.notification.NotificationOutboxWriteException;
import com.weav.workspace.application.notification.ConnectionNotificationRecorder;
import com.weav.workspace.application.port.out.ConnectionProviderPort;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.GoogleOAuthPort;
import com.weav.workspace.application.port.out.OAuthCompletionStore;
import com.weav.workspace.application.port.out.OAuthStateStore;
import com.weav.workspace.application.service.ConnectionProviderRegistry;
import com.weav.workspace.application.service.ConnectionUsageProtection;
import com.weav.workspace.application.service.CredentialPayloadCodec;
import com.weav.workspace.application.service.GoogleOAuthScopePolicy;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.ConflictException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Credential;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.TransactionException;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Two-step Google connect: the public callback only parks the code (PKCE-bound); the initiating
 * user then completes it with a bearer token, and only that step verifies Google and persists the
 * encrypted credential/status.
 */
@Service
public final class CompleteConnectionOAuthUseCase {

    private static final int MAX_AUTHORIZATION_CODE_LENGTH = 8192;
    private static final SecureRandom COMPLETION_RANDOM = new SecureRandom();

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
    private final ConnectionNotificationRecorder notificationRecorder;
    private final OAuthCompletionStore completionStore;

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
            Clock clock,
            ConnectionNotificationRecorder notificationRecorder,
            OAuthCompletionStore completionStore) {
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
        this.notificationRecorder = Objects.requireNonNull(notificationRecorder, "notificationRecorder must not be null");
        this.completionStore = Objects.requireNonNull(completionStore, "completionStore must not be null");
    }

    /**
     * Single-step completion straight from a consumed state. Not reachable over HTTP; it bypasses the
     * authenticated binding and exists only for tests of the completion pipeline.
     */
    public ConnectionTestResult execute(String state, String authorizationCode) {
        return execute(state, authorizationCode, null);
    }

    /** The callback error is handled only after state consumption and is never reflected to the client. */
    public ConnectionTestResult execute(String state, String authorizationCode, String callbackError) {
        OAuthStateStore.ConsumedState consumedState = stateStore.consumeForCallback(state)
                .orElseThrow(() -> new BadRequestException("Google authorization state is invalid or expired"));
        try {
            return executePending(
                    consumedState.pendingState(),
                    consumedState.notificationOrigin(),
                    authorizationCode,
                    callbackError);
        } finally {
            stateStore.releaseOrigin(consumedState);
        }
    }

    /**
     * Consumes the callback state exactly once and parks the authorization code as a short-lived
     * pending completion. Nothing is exchanged or persisted here: the public callback cannot prove
     * which user owns the browser, so {@link #completeAuthenticated} finishes the flow for the
     * initiating user only. Exchanging at completion also means no Google token ever exists unbound.
     */
    public GoogleOAuthCallbackResult executeForCallback(
            String state,
            String authorizationCode,
            String callbackError) {
        final OAuthStateStore.ConsumedState consumedState;
        try {
            consumedState = stateStore.consumeForCallback(state).orElse(null);
        } catch (DependencyUnavailableException exception) {
            // Redis is the only state authority. Without it there is no trusted
            // connection id and the callback must fail closed.
            return GoogleOAuthCallbackResult.failure(
                    null, GoogleOAuthCallbackResult.FailureReason.STATE_INVALID);
        }
        if (consumedState == null) {
            return GoogleOAuthCallbackResult.failure(
                    null, GoogleOAuthCallbackResult.FailureReason.STATE_INVALID);
        }

        UUID connectionId = consumedState.pendingState().connectionId();
        boolean handedOff = false;
        try {
            if (callbackError != null && !callbackError.isBlank()) {
                return GoogleOAuthCallbackResult.failure(
                        connectionId, GoogleOAuthCallbackResult.FailureReason.AUTHORIZATION_DENIED);
            }
            if (!isValidAuthorizationCode(authorizationCode)) {
                return GoogleOAuthCallbackResult.failure(
                        connectionId, GoogleOAuthCallbackResult.FailureReason.TOKEN_EXCHANGE_FAILED);
            }
            String completionId = randomCompletionId();
            try {
                completionStore.save(
                        completionId,
                        new OAuthCompletionStore.PendingCompletion(consumedState, authorizationCode));
                handedOff = true;
            } catch (DependencyUnavailableException exception) {
                return GoogleOAuthCallbackResult.failure(
                        connectionId, GoogleOAuthCallbackResult.FailureReason.TOKEN_EXCHANGE_FAILED);
            }
            return GoogleOAuthCallbackResult.pending(connectionId, completionId);
        } finally {
            if (!handedOff) {
                stateStore.releaseOrigin(consumedState);
            }
        }
    }

    /**
     * Finishes a pending Google connection for the user who started it. The record is consumed
     * before any check, so a mismatched or replayed id can never be retried.
     */
    public ConnectionTestResult completeAuthenticated(
            UUID actorUserId, UUID workspaceId, UUID connectionId, String completionId) {
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        OAuthCompletionStore.PendingCompletion completion = completionStore.consume(completionId)
                .orElseThrow(CompleteConnectionOAuthUseCase::completionUnavailable);
        OAuthStateStore.ConsumedState consumedState = completion.consumedState();
        OAuthPendingState pendingState = consumedState.pendingState();
        try {
            if (!pendingState.userId().equals(actorUserId)
                    || !pendingState.workspaceId().equals(workspaceId)
                    || !pendingState.connectionId().equals(connectionId)) {
                // Same response as unknown/expired/replayed: never reveal that a record exists.
                throw completionUnavailable();
            }
            return executePending(
                    pendingState, consumedState.notificationOrigin(), completion.authorizationCode(), null);
        } catch (NotificationOutboxWriteException | DataAccessException | TransactionException exception) {
            // State is already consumed; report a retryable dependency failure without internals.
            throw new DependencyUnavailableException();
        } finally {
            stateStore.releaseOrigin(consumedState);
        }
    }

    private static ConflictException completionUnavailable() {
        return new ConflictException("OAuth completion is invalid, expired or already used");
    }

    private static String randomCompletionId() {
        byte[] bytes = new byte[32];
        COMPLETION_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private ConnectionTestResult executePending(
            OAuthPendingState pendingState,
            OAuthStateStore.NotificationOrigin notificationOrigin,
            String authorizationCode,
            String callbackError) {
        if (callbackError != null && !callbackError.isBlank()) {
            if ("access_denied".equals(callbackError)) {
                throw new BadRequestException("Google authorization was denied");
            }
            throw new BadRequestException("Google authorization did not complete");
        }
        if (!isValidAuthorizationCode(authorizationCode)) {
            throw new BadRequestException("Google authorization response is invalid");
        }

        ConnectionProvider provider = pendingState.provider();
        ConnectionUsageProtection.Authorization initialAuthorization = usageProtection.authorize(
                pendingState.userId(), pendingState.workspaceId(), pendingState.connectionId());
        Connection connection = loadAndValidateConnection(pendingState);
        ConnectionProviderPort googleProvider = providerRegistry.resolve(provider);
        googleProvider.validateConfig(connection.getAuthType(), connection.getConfig());
        usageProtection.requireUnused(
                initialAuthorization, ConnectionUsageProtection.UsageScope.MEMBER_ONLY);

        GoogleOAuthTokenResponse tokens = googleOAuthPort.exchangeAuthorizationCode(
                authorizationCode, pendingState.codeVerifier());
        Instant accessTokenExpiresAt = clock.instant().plusSeconds(tokens.expiresInSeconds());
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
        ConnectionUsageProtection.Authorization finalAuthorization = usageProtection.authorize(
                pendingState.userId(), pendingState.workspaceId(), pendingState.connectionId());
        usageProtection.requireUnused(
                finalAuthorization, ConnectionUsageProtection.UsageScope.MEMBER_ONLY);

        final byte[] encryptedCredential;
        final String encryptionKeyVersion;
        if (verification.outcome() == ConnectionTestResult.ConnectionTestOutcome.VERIFIED) {
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

        return usageProtection.reauthorizeAndMutate(
                pendingState.userId(),
                pendingState.workspaceId(),
                pendingState.connectionId(),
                finalAuthorization,
                ConnectionUsageProtection.UsageScope.MEMBER_ONLY,
                (membership, currentConnection) -> {
                    validatePendingConnection(pendingState, currentConnection);
                    if (verification.outcome() == ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID) {
                        if (currentConnection.getStatus()
                                != com.weav.workspace.domain.valueobject.ConnectionStatus.INVALID) {
                            currentConnection.markInvalid();
                            connectionRepository.save(currentConnection);
                            notificationRecorder.recordInvalid(currentConnection, pendingState.userId());
                        }
                        return verification;
                    }

                    Credential currentCredential = credentialRepository
                            .findByConnectionId(currentConnection.getId()).orElse(null);
                    Instant now = clock.instant();
                    if (!accessTokenExpiresAt.isAfter(now)) {
                        throw new DependencyUnavailableException();
                    }
                    boolean newlyConnected = currentConnection.getStatus()
                            != ConnectionStatus.ACTIVE;
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
                    if (newlyConnected
                            && notificationOrigin == OAuthStateStore.NotificationOrigin.NON_ACTIVE) {
                        notificationRecorder.recordConnected(currentConnection, pendingState.userId());
                    }
                    return verification;
                });
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
}
