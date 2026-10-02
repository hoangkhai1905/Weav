package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.AuthenticatedUserResult;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class GetCurrentUserUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-09-05T10:15:30Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID OTHER_USER_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID SESSION_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");

    private final UserRepository userRepository = mock(UserRepository.class);
    private final UserSessionRepository sessionRepository = mock(UserSessionRepository.class);
    private final GetCurrentUserUseCase useCase = new GetCurrentUserUseCase(userRepository, sessionRepository, CLOCK);

    @Test
    void returnsPublicUserForMatchingActiveSessionAndUser() {
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Optional.of(session(USER_ID, NOW.plusSeconds(1), null)));
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(user(UserStatus.ACTIVE)));

        AuthenticatedUserResult result = useCase.execute(USER_ID, SESSION_ID);

        assertEquals(USER_ID, result.id());
        assertEquals("Stored.User@Example.com", result.email());
        assertEquals(SystemRole.USER, result.systemRole());
        assertEquals(UserStatus.ACTIVE, result.status());
    }

    @Test
    void rejectsMissingMismatchedRevokedAndExpiredSessionsWithSameUnauthorizedResult() {
        when(sessionRepository.findById(SESSION_ID))
                .thenReturn(
                        Optional.empty(),
                        Optional.of(session(OTHER_USER_ID, NOW.plusSeconds(1), null)),
                        Optional.of(session(USER_ID, NOW.plusSeconds(1), NOW.minusSeconds(1))),
                        Optional.of(session(USER_ID, NOW, null))
                );

        UnauthorizedException missing = assertUnauthorized();
        UnauthorizedException mismatch = assertUnauthorized();
        UnauthorizedException revoked = assertUnauthorized();
        UnauthorizedException expired = assertUnauthorized();

        assertEquals(missing.getMessage(), mismatch.getMessage());
        assertEquals(missing.getMessage(), revoked.getMessage());
        assertEquals(missing.getMessage(), expired.getMessage());
    }

    @Test
    void rejectsMissingOrDisabledUserAfterSessionValidation() {
        when(sessionRepository.findById(SESSION_ID)).thenReturn(
                Optional.of(session(USER_ID, NOW.plusSeconds(1), null)),
                Optional.of(session(USER_ID, NOW.plusSeconds(1), null))
        );
        when(userRepository.findById(USER_ID)).thenReturn(Optional.empty(), Optional.of(user(UserStatus.DISABLED)));

        UnauthorizedException missing = assertUnauthorized();
        UnauthorizedException disabled = assertUnauthorized();

        assertEquals(missing.getMessage(), disabled.getMessage());
    }

    private UnauthorizedException assertUnauthorized() {
        return assertThrows(UnauthorizedException.class, () -> useCase.execute(USER_ID, SESSION_ID));
    }

    private static UserSession session(UUID userId, Instant expiresAt, Instant revokedAt) {
        return new UserSession(
                SESSION_ID,
                userId,
                "refresh-hash",
                null,
                null,
                expiresAt,
                revokedAt,
                null,
                NOW.minus(Duration.ofDays(1))
        );
    }

    private static User user(UserStatus status) {
        return new User(
                USER_ID,
                "Stored.User@Example.com",
                "password-hash",
                null,
                null,
                SystemRole.USER,
                status,
                NOW.minus(Duration.ofDays(2)),
                NOW.minus(Duration.ofDays(1))
        );
    }
}
