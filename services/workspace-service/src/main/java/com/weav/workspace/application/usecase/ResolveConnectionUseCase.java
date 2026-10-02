package com.weav.workspace.application.usecase;

import com.weav.workspace.application.notification.ConnectionNotificationRecorder;
import com.weav.workspace.application.dto.GoogleOAuthRefreshResponse;
import com.weav.workspace.application.dto.GoogleOAuthTokenResponse;
import com.weav.workspace.application.dto.ResolvedConnectionCredential;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.GoogleOAuthPort;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkspaceMutationLock;
import com.weav.workspace.application.service.CredentialPayloadCodec;
import com.weav.workspace.application.service.GoogleOAuthScopePolicy;
import com.weav.workspace.domain.exception.AuthenticationRejectedException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.exception.InvalidStateException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Credential;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/** Resolves the minimum runtime authentication payload for an active, workspace-scoped connection. */
@Service
public final class ResolveConnectionUseCase {

    private final ConnectionRepository connectionRepository;
    private final CredentialRepository credentialRepository;
    private final CredentialCryptoPort crypto;
    private final CredentialPayloadCodec payloadCodec;
    private final GoogleOAuthPort googleOAuthPort;
    private final GoogleOAuthScopePolicy scopePolicy;
    private final TransactionRunner transactionRunner;
    private final Clock clock;
    private final WorkspaceMutationLock workspaceMutationLock;
    private final ConnectionNotificationRecorder notificationRecorder;
    private final ConcurrentMap<UUID, CompletableFuture<ResolvedConnectionCredential>> inFlightRefreshes =
            new ConcurrentHashMap<>();

    public ResolveConnectionUseCase(
            ConnectionRepository connectionRepository,
            CredentialRepository credentialRepository,
            CredentialCryptoPort crypto,
            CredentialPayloadCodec payloadCodec,
            GoogleOAuthPort googleOAuthPort,
            GoogleOAuthScopePolicy scopePolicy,
            TransactionRunner transactionRunner,
            Clock clock,
            WorkspaceMutationLock workspaceMutationLock,
            ConnectionNotificationRecorder notificationRecorder) {
        this.connectionRepository = Objects.requireNonNull(connectionRepository);
        this.credentialRepository = Objects.requireNonNull(credentialRepository);
        this.crypto = Objects.requireNonNull(crypto);
        this.payloadCodec = Objects.requireNonNull(payloadCodec);
        this.googleOAuthPort = Objects.requireNonNull(googleOAuthPort);
        this.scopePolicy = Objects.requireNonNull(scopePolicy);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.clock = Objects.requireNonNull(clock);
        this.workspaceMutationLock = Objects.requireNonNull(workspaceMutationLock);
        this.notificationRecorder = Objects.requireNonNull(notificationRecorder);
    }

    public ResolvedConnectionCredential execute(UUID workspaceId, UUID connectionId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");

        Connection connection = findConnection(workspaceId, connectionId);
        requireActive(connection);
        if (connection.getAuthType() == ConnectionAuthType.NONE) {
            return new ResolvedConnectionCredential(connection.getProvider(), connection.getAuthType(), Map.of());
        }

        Credential credential = credentialRepository.findByConnectionId(connectionId)
                .orElseThrow(() -> new InvalidStateException("Connection credential is missing"));
        Map<String, Object> payload = decodeStoredCredential(connection, credential);

        if (isGoogleOAuth(connection)) {
            List<String> grantedScopes = stringList(payload.get("grantedScopes"));
            if (grantedScopes == null || !scopePolicy.containsRequiredScopes(connection.getProvider(), grantedScopes)) {
                throw new InvalidStateException("Google connection authorization is invalid");
            }
            Instant expiresAt = credential.getExpiresAt();
            if (expiresAt == null) {
                throw new InvalidStateException("Google access token expiry is missing");
            }
            if (expiresAt.isAfter(clock.instant())) {
                return googleAccessToken(connection, payload);
            }
            return refreshSingleFlight(connection);
        }

        if (credential.isExpired(clock.instant())) {
            throw new InvalidStateException("Connection credential has expired");
        }
        return resolvedCredential(connection, payload);
    }

    /**
     * Concurrent resolves of the same expired connection share one Google refresh. The leader's
     * outcome (token or error) is delivered to every waiter; the entry is removed before the
     * future completes so the next call after a failure retries.
     */
    private ResolvedConnectionCredential refreshSingleFlight(Connection connection) {
        if (transactionRunner.hasAmbientTransaction()) {
            throw new InvalidStateException("Google refresh cannot run inside an active transaction");
        }
        CompletableFuture<ResolvedConnectionCredential> mine = new CompletableFuture<>();
        // ponytail: per-JVM only; across replicas a double refresh is harmless because Google does
        // not rotate refresh tokens on refresh; upgrade to a Valkey lock if that changes.
        CompletableFuture<ResolvedConnectionCredential> leader = inFlightRefreshes.putIfAbsent(
                connection.getId(), mine);
        if (leader != null) {
            try {
                return leader.join();
            } catch (CompletionException exception) {
                if (exception.getCause() instanceof RuntimeException failure) {
                    throw failure;
                }
                throw new DependencyUnavailableException();
            }
        }
        try {
            ResolvedConnectionCredential resolved = refreshGoogleAccessToken(connection);
            inFlightRefreshes.remove(connection.getId(), mine);
            mine.complete(resolved);
            return resolved;
        } catch (RuntimeException exception) {
            inFlightRefreshes.remove(connection.getId(), mine);
            mine.completeExceptionally(exception);
            throw exception;
        }
    }

    private ResolvedConnectionCredential refreshGoogleAccessToken(Connection connection) {
        // Fresh read: another caller may have refreshed (or a reconnect swapped the credential)
        // after this request first looked.
        Credential originalCredential = credentialRepository.findByConnectionId(connection.getId())
                .orElseThrow(() -> new InvalidStateException("Connection credential is missing"));
        Map<String, Object> originalPayload = decodeStoredCredential(connection, originalCredential);
        if (originalCredential.getExpiresAt() != null
                && originalCredential.getExpiresAt().isAfter(clock.instant())) {
            return googleAccessToken(connection, originalPayload);
        }

        String originalRefreshToken = textValue(originalPayload, "refreshToken");
        final GoogleOAuthRefreshResponse refresh;
        try {
            refresh = googleOAuthPort.refreshAccessToken(originalRefreshToken);
        } catch (AuthenticationRejectedException exception) {
            markInvalidIfCurrent(connection, originalCredential, originalRefreshToken, null);
            throw new InvalidStateException("Google connection authorization was rejected");
        } catch (DependencyUnavailableException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            // Provider exceptions and malformed responses must not cross the internal boundary.
            throw new DependencyUnavailableException();
        }
        if (refresh == null) {
            throw new DependencyUnavailableException();
        }
        if (!scopePolicy.containsRequiredScopes(connection.getProvider(), refresh.grantedScopes())) {
            markInvalidIfCurrent(connection, originalCredential, originalRefreshToken, refresh.refreshToken());
            throw new InvalidStateException("Google connection authorization no longer grants required access");
        }

        String nextRefreshToken = refresh.refreshToken() == null
                ? originalRefreshToken
                : refresh.refreshToken();
        final GoogleOAuthTokenResponse replacementTokens;
        final byte[] encryptedPayload;
        final String keyVersion;
        final Instant accessTokenExpiresAt;
        try {
            replacementTokens = new GoogleOAuthTokenResponse(
                    refresh.accessToken(),
                    nextRefreshToken,
                    refresh.tokenType(),
                    refresh.grantedScopes(),
                    refresh.expiresInSeconds());
            accessTokenExpiresAt = clock.instant().plusSeconds(replacementTokens.expiresInSeconds());
            encryptedPayload = crypto.encrypt(payloadCodec.encodeGoogleOAuth(connection, replacementTokens), connection.getId());
            keyVersion = crypto.currentKeyVersion();
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }

        if (!accessTokenExpiresAt.isAfter(clock.instant())) {
            throw new DependencyUnavailableException();
        }

        return transactionRunner.required(() -> {
            workspaceMutationLock.lock(connection.getWorkspaceId());
            Connection currentConnection = connectionRepository
                    .findByWorkspaceIdAndId(connection.getWorkspaceId(), connection.getId())
                    .orElseThrow(() -> new ResourceNotFoundException("Connection not found"));
            requireSameActiveConnection(connection, currentConnection);
            // Row lock: a stale writer must not overwrite a credential stored while Google responded.
            Credential currentCredential = credentialRepository.findByConnectionIdForUpdate(connection.getId())
                    .orElseThrow(() -> new InvalidStateException("Connection credential changed during refresh"));
            Map<String, Object> currentPayload = decodeStoredCredential(currentConnection, currentCredential);
            Instant now = clock.instant();
            boolean replaced = !currentCredential.getId().equals(originalCredential.getId());
            Instant currentExpiresAt = currentCredential.getExpiresAt();
            if (currentExpiresAt != null && currentExpiresAt.isAfter(now)
                    && (replaced || originalCredential.getExpiresAt() == null
                    || currentExpiresAt.isAfter(originalCredential.getExpiresAt()))) {
                // Another refresh or a reconnect already stored a usable token: keep it.
                return googleAccessToken(currentConnection, currentPayload);
            }
            String currentRefreshToken = textValue(currentPayload, "refreshToken");
            if (replaced
                    || (!currentRefreshToken.equals(originalRefreshToken)
                    && !currentRefreshToken.equals(nextRefreshToken))) {
                throw new InvalidStateException("Connection credential changed during refresh");
            }
            if (!accessTokenExpiresAt.isAfter(now)) {
                throw new DependencyUnavailableException();
            }
            credentialRepository.save(new Credential(
                    currentCredential.getId(),
                    currentConnection.getId(),
                    encryptedPayload,
                    keyVersion,
                    accessTokenExpiresAt,
                    currentCredential.getCreatedAt(),
                    now));
            return googleAccessToken(currentConnection, Map.of("accessToken", replacementTokens.accessToken()));
        });
    }

    private void markInvalidIfCurrent(
            Connection originalConnection,
            Credential originalCredential,
            String originalRefreshToken,
            String refreshTokenFromResponse) {
        transactionRunner.required(() -> {
            workspaceMutationLock.lock(originalConnection.getWorkspaceId());
            Connection currentConnection = connectionRepository
                    .findByWorkspaceIdAndId(originalConnection.getWorkspaceId(), originalConnection.getId())
                    .orElse(null);
            if (currentConnection == null || !isSameActiveConnection(originalConnection, currentConnection)) {
                return Boolean.TRUE;
            }
            Credential currentCredential = credentialRepository.findByConnectionId(originalConnection.getId())
                    .orElse(null);
            if (currentCredential == null || !currentCredential.getId().equals(originalCredential.getId())) {
                return Boolean.TRUE;
            }
            Map<String, Object> currentPayload = decodeStoredCredential(currentConnection, currentCredential);
            String currentRefreshToken = textValue(currentPayload, "refreshToken");
            boolean stillSameGrant = currentRefreshToken.equals(originalRefreshToken)
                    || (refreshTokenFromResponse != null && currentRefreshToken.equals(refreshTokenFromResponse));
            boolean anotherRefreshAlreadySucceeded = currentCredential.getExpiresAt() != null
                    && currentCredential.getExpiresAt().isAfter(clock.instant());
            if (stillSameGrant && !anotherRefreshAlreadySucceeded) {
                currentConnection.markInvalid();
                connectionRepository.save(currentConnection);
                notificationRecorder.recordInvalid(currentConnection, null);
            }
            return Boolean.TRUE;
        });
    }

    private Connection findConnection(UUID workspaceId, UUID connectionId) {
        return connectionRepository.findByWorkspaceIdAndId(workspaceId, connectionId)
                .orElseThrow(() -> new ResourceNotFoundException("Connection not found"));
    }

    private void requireActive(Connection connection) {
        if (connection.getStatus() != ConnectionStatus.ACTIVE) {
            throw new InvalidStateException("Connection is not active");
        }
    }

    private void requireSameActiveConnection(Connection original, Connection current) {
        if (!isSameActiveConnection(original, current)) {
            throw new InvalidStateException("Connection changed during credential refresh");
        }
    }

    private boolean isSameActiveConnection(Connection original, Connection current) {
        return current.getStatus() == ConnectionStatus.ACTIVE
                && current.getProvider() == original.getProvider()
                && current.getAuthType() == original.getAuthType()
                && Objects.equals(current.getLastVerifiedAt(), original.getLastVerifiedAt());
    }

    private Map<String, Object> decodeStoredCredential(Connection connection, Credential credential) {
        try {
            return payloadCodec.decode(connection, crypto.decrypt(credential.getEncryptedPayload(), credential.getEncryptionKeyVersion(), connection.getId()));
        } catch (RuntimeException exception) {
            throw new InvalidStateException("Stored connection credential is invalid");
        }
    }

    private ResolvedConnectionCredential googleAccessToken(
            Connection connection,
            Map<String, Object> payload) {
        return new ResolvedConnectionCredential(
                connection.getProvider(),
                connection.getAuthType(),
                Map.of("accessToken", textValue(payload, "accessToken")));
    }

    private ResolvedConnectionCredential resolvedCredential(Connection connection, Map<String, Object> payload) {
        Map<String, String> auth = switch (connection.getAuthType()) {
            case NONE -> Map.of();
            case TOKEN -> Map.of("token", textValue(payload, "token"));
            case API_KEY -> Map.of("apiKey", textValue(payload, "apiKey"));
            case BASIC -> Map.of(
                    "username", textValue(payload, "username"),
                    "password", textValue(payload, "password"));
            case OAUTH2 -> throw new InvalidStateException("Connection authorization type is invalid");
        };
        return new ResolvedConnectionCredential(connection.getProvider(), connection.getAuthType(), auth);
    }

    private boolean isGoogleOAuth(Connection connection) {
        return connection.getAuthType() == ConnectionAuthType.OAUTH2
                && (connection.getProvider() == ConnectionProvider.GMAIL
                || connection.getProvider() == ConnectionProvider.GOOGLE_SHEETS);
    }

    private String textValue(Map<String, Object> payload, String field) {
        Object value = payload.get(field);
        if (!(value instanceof String text) || text.isBlank()) {
            throw new InvalidStateException("Stored connection credential is invalid");
        }
        return text;
    }

    private List<String> stringList(Object value) {
        if (!(value instanceof List<?> values)
                || values.stream().anyMatch(item -> !(item instanceof String))) {
            return null;
        }
        @SuppressWarnings("unchecked")
        List<String> strings = (List<String>) values;
        return strings;
    }
}
