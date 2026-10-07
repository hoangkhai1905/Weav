package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.OAuthAuthorizationResponse;
import com.weav.workspace.application.dto.OAuthPendingState;
import com.weav.workspace.application.port.out.GoogleOAuthPort;
import com.weav.workspace.application.port.out.OAuthStateStore;
import com.weav.workspace.application.service.ConnectionUsageProtection;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

/** Starts a one-time, membership-authorized Google connection authorization. */
@Service
public final class StartConnectionOAuthUseCase {

    private static final SecureRandom STATE_RANDOM = new SecureRandom();

    private final ConnectionRepository connectionRepository;
    private final ConnectionUsageProtection usageProtection;
    private final OAuthStateStore stateStore;
    private final GoogleOAuthPort googleOAuthPort;

    public StartConnectionOAuthUseCase(
            ConnectionRepository connectionRepository,
            ConnectionUsageProtection usageProtection,
            OAuthStateStore stateStore,
            GoogleOAuthPort googleOAuthPort) {
        this.connectionRepository = Objects.requireNonNull(
                connectionRepository, "connectionRepository must not be null");
        this.usageProtection = Objects.requireNonNull(usageProtection, "usageProtection must not be null");
        this.stateStore = Objects.requireNonNull(stateStore, "stateStore must not be null");
        this.googleOAuthPort = Objects.requireNonNull(googleOAuthPort, "googleOAuthPort must not be null");
    }

    public OAuthAuthorizationResponse execute(UUID actorUserId, UUID workspaceId, UUID connectionId) {
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");

        ConnectionUsageProtection.Authorization authorization = usageProtection.authorize(
                actorUserId, workspaceId, connectionId);
        Connection connection = loadConnection(workspaceId, connectionId);
        validateGoogleConnection(connection);

        String state = randomToken(32);
        // Build the URL first so missing OAuth configuration fails before any state is stored.
        String codeVerifier = randomToken(48); // 64 base64url chars
        String authorizationUrl = googleOAuthPort.authorizationUrl(
                connection.getProvider(), state, codeChallenge(codeVerifier));
        usageProtection.requireUnused(authorization, ConnectionUsageProtection.UsageScope.MEMBER_ONLY);
        OAuthPendingState pendingState = new OAuthPendingState(
                workspaceId, connectionId, actorUserId, connection.getProvider(), codeVerifier);
        AtomicReference<DependencyUnavailableException> stateWriteFailure = new AtomicReference<>();
        usageProtection.reauthorizeAndMutate(
                actorUserId,
                workspaceId,
                connectionId,
                authorization,
                ConnectionUsageProtection.UsageScope.MEMBER_ONLY,
                (membership, currentConnection) -> {
                    validateGoogleConnection(currentConnection);
                    boolean activeAtLockedStart = currentConnection.getStatus()
                            == com.weav.workspace.domain.valueobject.ConnectionStatus.ACTIVE;
                    // Status and credential stay untouched: only the bound completion step swaps
                    // the credential, so abandoning consent never breaks a live connection.
                    try {
                        stateStore.saveForStart(state, pendingState, activeAtLockedStart);
                    } catch (DependencyUnavailableException exception) {
                        // Fail closed: never return an authorization URL whose one-time
                        // callback state was not saved.
                        stateWriteFailure.set(exception);
                    }
                    return Boolean.TRUE;
                });

        if (stateWriteFailure.get() != null) {
            throw stateWriteFailure.get();
        }
        return new OAuthAuthorizationResponse(authorizationUrl);
    }

    private Connection loadConnection(UUID workspaceId, UUID connectionId) {
        return connectionRepository.findByWorkspaceIdAndId(workspaceId, connectionId)
                .orElseThrow(() -> new ResourceNotFoundException("Connection not found", connectionId));
    }

    private void validateGoogleConnection(Connection connection) {
        ConnectionProvider provider = connection.getProvider();
        if (!provider.isGoogleOAuth()
                || connection.getAuthType() != ConnectionAuthType.OAUTH2
                || (connection.getConfig() != null && !connection.getConfig().isEmpty())) {
            throw new BadRequestException("Google connection configuration is invalid");
        }
    }

    private static String codeChallenge(String codeVerifier) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(codeVerifier.getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private String randomToken(int byteCount) {
        byte[] bytes = new byte[byteCount];
        STATE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
