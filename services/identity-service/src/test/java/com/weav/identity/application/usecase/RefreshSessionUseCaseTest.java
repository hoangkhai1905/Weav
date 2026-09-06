package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.GeneratedRefreshToken;
import com.weav.identity.application.dto.IssuedAccessToken;
import com.weav.identity.application.dto.RefreshTokenCommand;
import com.weav.identity.application.dto.TokenPairResult;
import com.weav.identity.application.port.out.AccessTokenIssuer;
import com.weav.identity.application.port.out.RefreshTokenGenerator;
import com.weav.identity.application.port.out.TransactionRunner;
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
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RefreshSessionUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-09-05T10:15:30Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID SESSION_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final String SUBMITTED_TOKEN = "submitted-refresh-token";
    private static final String SUBMITTED_HASH = "submitted-refresh-hash";

    private final UserRepository userRepository = mock(UserRepository.class);
    private final UserSessionRepository sessionRepository = mock(UserSessionRepository.class);
    private final RefreshTokenGenerator refreshTokenGenerator = mock(RefreshTokenGenerator.class);
    private final AccessTokenIssuer accessTokenIssuer = mock(AccessTokenIssuer.class);
    private final TrackingTransactionRunner transactionRunner = new TrackingTransactionRunner();
    private final RefreshSessionUseCase useCase = new RefreshSessionUseCase(
            userRepository,
            sessionRepository,
            refreshTokenGenerator,
            accessTokenIssuer,
            transactionRunner,
            CLOCK
    );

    @Test
    void rotatesRefreshTokenAndPreservesAbsoluteSessionExpiry() {
        Instant absoluteExpiry = NOW.plus(Duration.ofDays(5));
        UserSession session = session(null, absoluteExpiry);
        User user = user(UserStatus.ACTIVE);
        when(refreshTokenGenerator.hash(SUBMITTED_TOKEN)).thenReturn(SUBMITTED_HASH);
        when(sessionRepository.findByRefreshTokenHashForUpdate(SUBMITTED_HASH))
                .thenReturn(Optional.of(session));
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(user));
        when(refreshTokenGenerator.generate())
                .thenReturn(new GeneratedRefreshToken("replacement-refresh-token", "replacement-refresh-hash"));
        when(sessionRepository.save(session)).thenAnswer(invocation -> {
            assertTrue(transactionRunner.inTransaction);
            return invocation.getArgument(0);
        });
        when(accessTokenIssuer.issue(USER_ID, SESSION_ID, SystemRole.USER, UserStatus.ACTIVE))
                .thenAnswer(invocation -> {
                    assertTrue(transactionRunner.inTransaction);
                    return new IssuedAccessToken("access-token", NOW.plus(Duration.ofMinutes(15)));
                });

        TokenPairResult result = useCase.execute(new RefreshTokenCommand(SUBMITTED_TOKEN));

        assertEquals(1, transactionRunner.invocations);
        assertEquals("replacement-refresh-hash", session.getRefreshTokenHash());
        assertEquals(NOW, session.getLastUsedAt());
        assertEquals(absoluteExpiry, session.getExpiresAt());
        assertEquals("access-token", result.accessToken());
        assertEquals("replacement-refresh-token", result.refreshToken());
        assertEquals("Bearer", result.tokenType());
        assertEquals(Duration.ofMinutes(15).toSeconds(), result.expiresIn());
        assertEquals(absoluteExpiry, result.refreshExpiresAt());
        assertEquals(USER_ID, result.user().id());
        verify(sessionRepository).save(session);
    }

    @Test
    void rejectsRevokedExpiredAndUnknownTokensWithoutTokenLeakage() {
        UserSession revoked = session(NOW.minus(Duration.ofMinutes(1)), NOW.plus(Duration.ofDays(1)));
        UserSession expired = session(null, NOW.minus(Duration.ofSeconds(1)));
        when(refreshTokenGenerator.hash(SUBMITTED_TOKEN)).thenReturn(SUBMITTED_HASH);
        when(sessionRepository.findByRefreshTokenHashForUpdate(SUBMITTED_HASH))
                .thenReturn(Optional.of(revoked), Optional.of(expired), Optional.empty());

        List<UnauthorizedException> failures = List.of(
                assertUnauthorized(),
                assertUnauthorized(),
                assertUnauthorized()
        );

        assertTrue(failures.stream().allMatch(failure -> "UNAUTHORIZED".equals(failure.getCode())));
        assertEquals(1, failures.stream().map(Throwable::getMessage).distinct().count());
        assertTrue(failures.stream().allMatch(failure -> "Authentication failed".equals(failure.getMessage())));
        assertTrue(failures.stream().noneMatch(failure -> failure.getMessage().contains(SUBMITTED_TOKEN)));
        assertTrue(failures.stream().noneMatch(failure -> failure.getMessage().contains(SUBMITTED_HASH)));
        assertEquals(3, transactionRunner.invocations);
        verify(userRepository, never()).findById(any(UUID.class));
        verify(refreshTokenGenerator, never()).generate();
        verify(sessionRepository, never()).save(any(UserSession.class));
        verify(accessTokenIssuer, never()).issue(any(), any(), any(), any());
    }

    @Test
    void rejectsInactiveUserBeforeRotatingSession() {
        UserSession session = session(null, NOW.plus(Duration.ofDays(1)));
        when(refreshTokenGenerator.hash(SUBMITTED_TOKEN)).thenReturn(SUBMITTED_HASH);
        when(sessionRepository.findByRefreshTokenHashForUpdate(SUBMITTED_HASH))
                .thenReturn(Optional.of(session));
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(user(UserStatus.DISABLED)));

        UnauthorizedException failure = assertUnauthorized();

        assertEquals("Authentication failed", failure.getMessage());
        assertFalse(failure.getMessage().contains(SUBMITTED_TOKEN));
        assertEquals("submitted-refresh-hash", session.getRefreshTokenHash());
        verify(refreshTokenGenerator, never()).generate();
        verify(sessionRepository, never()).save(any(UserSession.class));
        verify(accessTokenIssuer, never()).issue(any(), any(), any(), any());
    }

    private UnauthorizedException assertUnauthorized() {
        return assertThrows(UnauthorizedException.class,
                () -> useCase.execute(new RefreshTokenCommand(SUBMITTED_TOKEN)));
    }

    private static UserSession session(Instant revokedAt, Instant expiresAt) {
        return new UserSession(
                SESSION_ID,
                USER_ID,
                SUBMITTED_HASH,
                "test-agent",
                "127.0.0.1",
                expiresAt,
                revokedAt,
                NOW.minus(Duration.ofHours(1)),
                NOW.minus(Duration.ofDays(1))
        );
    }

    private static User user(UserStatus status) {
        return new User(
                USER_ID,
                "user@example.com",
                "password-hash",
                "User",
                null,
                SystemRole.USER,
                status,
                NOW.minus(Duration.ofDays(10)),
                NOW.minus(Duration.ofDays(1))
        );
    }

    private static final class TrackingTransactionRunner implements TransactionRunner {
        private boolean inTransaction;
        private int invocations;

        @Override
        public <T> T required(Supplier<T> work) {
            invocations++;
            inTransaction = true;
            try {
                return work.get();
            } finally {
                inTransaction = false;
            }
        }
    }
}
