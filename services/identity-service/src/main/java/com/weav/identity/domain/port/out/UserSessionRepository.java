package com.weav.identity.domain.port.out;

import com.weav.identity.domain.model.UserSession;
import java.util.Optional;
import java.util.UUID;

public interface UserSessionRepository {
    UserSession save(UserSession session);
    Optional<UserSession> findById(UUID id);
    Optional<UserSession> findByRefreshTokenHash(String refreshTokenHash);
}
