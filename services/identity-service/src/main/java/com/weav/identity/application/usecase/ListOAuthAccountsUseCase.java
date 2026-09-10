package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.OAuthAccountMetadata;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.domain.port.out.OAuthAccountRepository;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

/** Lists only safe OAuth metadata for the authenticated user's own account. */
public final class ListOAuthAccountsUseCase {

    private final CurrentIdentityGuard identityGuard;
    private final OAuthAccountRepository oauthAccountRepository;

    public ListOAuthAccountsUseCase(
            CurrentIdentityGuard identityGuard,
            OAuthAccountRepository oauthAccountRepository
    ) {
        this.identityGuard = Objects.requireNonNull(identityGuard, "identityGuard must not be null");
        this.oauthAccountRepository = Objects.requireNonNull(
                oauthAccountRepository, "oauthAccountRepository must not be null");
    }

    public List<OAuthAccountMetadata> execute(UUID userId, UUID sessionId) {
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        identityGuard.requireActiveUser(userId, sessionId);
        return oauthAccountRepository.findAllByUserId(userId).stream()
                .map(OAuthAccountMetadata::from)
                .toList();
    }
}
