package com.weav.identity.domain.port.out;

import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.model.UserSessionPage;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface UserSessionRepository {
    UserSession save(UserSession session);
    Optional<UserSession> findById(UUID id);
    Optional<UserSession> findByIdForUpdate(UUID id);
    Optional<UserSession> findByRefreshTokenHash(String refreshTokenHash);
    Optional<UserSession> findByRefreshTokenHashForUpdate(String refreshTokenHash);
    UserSessionPage findActiveByUserId(UUID userId, Instant now, int page, int size);
    int revokeAllForUser(UUID userId, Instant revokedAt);
}
