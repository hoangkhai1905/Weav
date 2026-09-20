package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.OAuthAuthorizationResponse;
import com.weav.workspace.application.dto.OAuthPendingState;
import com.weav.workspace.application.port.out.GoogleOAuthPort;
import com.weav.workspace.application.port.out.OAuthStateStore;
import com.weav.workspace.application.service.ConnectionUsageProtection;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.Objects;
import java.util.UUID;

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

        String state = randomState();
        // Build before mutating so missing OAuth configuration cannot disable a usable connection.
        String authorizationUrl = googleOAuthPort.authorizationUrl(connection.getProvider(), state);
        usageProtection.requireUnused(authorization, ConnectionUsageProtection.UsageScope.MEMBER_ONLY);
        OAuthPendingState pendingState = new OAuthPendingState(
                workspaceId, connectionId, actorUserId, connection.getProvider());
        usageProtection.reauthorizeAndMutate(
                actorUserId,
                workspaceId,
                connectionId,
                authorization,
                ConnectionUsageProtection.UsageScope.MEMBER_ONLY,
                (membership, currentConnection) -> {
                    validateGoogleConnection(currentConnection);
                    currentConnection.markDisabled();
                    connectionRepository.save(currentConnection);
                    return Boolean.TRUE;
                });

        // Redis is the only callback state authority. If it is unavailable, the connection
        // stays safely disabled and the authorization URL is not returned.
        stateStore.save(state, pendingState);
        return new OAuthAuthorizationResponse(authorizationUrl);
    }

    private Connection loadConnection(UUID workspaceId, UUID connectionId) {
        return connectionRepository.findByWorkspaceIdAndId(workspaceId, connectionId)
                .orElseThrow(() -> new ResourceNotFoundException("Connection not found", connectionId));
    }

    private void validateGoogleConnection(Connection connection) {
        ConnectionProvider provider = connection.getProvider();
        if ((provider != ConnectionProvider.GMAIL && provider != ConnectionProvider.GOOGLE_SHEETS)
                || connection.getAuthType() != ConnectionAuthType.OAUTH2
                || (connection.getConfig() != null && !connection.getConfig().isEmpty())) {
            throw new BadRequestException("Google connection configuration is invalid");
        }
    }

    private String randomState() {
        byte[] bytes = new byte[32];
        STATE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
