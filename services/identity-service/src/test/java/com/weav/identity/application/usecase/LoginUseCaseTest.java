package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.GeneratedRefreshToken;
import com.weav.identity.application.dto.IssuedAccessToken;
import com.weav.identity.application.dto.LoginCommand;
import com.weav.identity.application.dto.TokenPairResult;
import com.weav.identity.application.port.out.AccessTokenIssuer;
import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.RefreshTokenGenerator;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LoginUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-09-05T10:15:30Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    private static final Duration SESSION_LIFETIME = Duration.ofHours(36);
    private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");

    private final UserRepository userRepository = mock(UserRepository.class);
    private final UserSessionRepository sessionRepository = mock(UserSessionRepository.class);
    private final PasswordHasher passwordHasher = mock(PasswordHasher.class);
    private final RefreshTokenGenerator refreshTokenGenerator = mock(RefreshTokenGenerator.class);
    private final AccessTokenIssuer accessTokenIssuer = mock(AccessTokenIssuer.class);
    private final TrackingTransactionRunner transactionRunner = new TrackingTransactionRunner();
    private final LoginUseCase useCase = new LoginUseCase(
            userRepository,
            sessionRepository,
            passwordHasher,
            refreshTokenGenerator,
            accessTokenIssuer,
            transactionRunner,
            new AuthInputPolicy(),
            CLOCK,
            SESSION_LIFETIME
    );

    @Test
    void returnsSameUnauthorizedResultForMissingWrongDisabledAndOauthOnlyAccounts() {
        User active = user("real-hash", UserStatus.ACTIVE);
        User disabled = user("disabled-hash", UserStatus.DISABLED);
        User oauthOnly = user(null, UserStatus.ACTIVE);
        when(userRepository.findByEmail("user@example.com"))
                .thenReturn(Optional.empty(), Optional.of(active), Optional.of(disabled), Optional.of(oauthOnly));
        when(passwordHasher.matches(eq("password"), anyString()))
                .thenReturn(false, false, true, false);

        List<UnauthorizedException> failures = List.of(
                assertUnauthorized(),
                assertUnauthorized(),
                assertUnauthorized(),
                assertUnauthorized()
        );

        assertTrue(failures.stream().allMatch(failure -> "UNAUTHORIZED".equals(failure.getCode())));
        assertEquals(1, failures.stream().map(Throwable::getMessage).distinct().count());

        ArgumentCaptor<String> hashCaptor = ArgumentCaptor.forClass(String.class);
        verify(passwordHasher, org.mockito.Mockito.times(4)).matches(eq("password"), hashCaptor.capture());
        assertEquals(hashCaptor.getAllValues().get(0), hashCaptor.getAllValues().get(3));
        assertTrue(hashCaptor.getAllValues().get(0).startsWith("$2"));
        assertEquals("real-hash", hashCaptor.getAllValues().get(1));
        assertEquals("disabled-hash", hashCaptor.getAllValues().get(2));
        verify(sessionRepository, never()).save(any(UserSession.class));
    }

    @Test
    void createsOneSessionUsingConfiguredAbsoluteLifetimeAndReturnsTokenPairInsideTransaction() {
        User user = user("real-hash", UserStatus.ACTIVE);
        when(userRepository.findByEmail("user@example.com")).thenReturn(Optional.of(user));
        when(passwordHasher.matches("password", "real-hash")).thenReturn(true);
        when(refreshTokenGenerator.generate()).thenReturn(new GeneratedRefreshToken("plain-refresh", "refresh-hash"));
        when(sessionRepository.save(any(UserSession.class))).thenAnswer(invocation -> {
            assertTrue(transactionRunner.inTransaction);
            return invocation.getArgument(0);
        });
        when(accessTokenIssuer.issue(eq(USER_ID), any(UUID.class), eq(SystemRole.USER), eq(UserStatus.ACTIVE)))
                .thenAnswer(invocation -> {
                    assertTrue(transactionRunner.inTransaction);
                    return new IssuedAccessToken("access-token", NOW.plus(Duration.ofMinutes(15)));
                });

        TokenPairResult result = useCase.execute(new LoginCommand(" USER@example.com ", "password"));

        assertEquals(1, transactionRunner.invocations);
        assertEquals("access-token", result.accessToken());
        assertEquals("plain-refresh", result.refreshToken());
        assertEquals("Bearer", result.tokenType());
        assertEquals(Duration.ofMinutes(15).toSeconds(), result.expiresIn());
        assertEquals(NOW.plus(SESSION_LIFETIME), result.refreshExpiresAt());
        assertEquals(USER_ID, result.user().id());

        ArgumentCaptor<UserSession> sessionCaptor = ArgumentCaptor.forClass(UserSession.class);
        verify(sessionRepository).save(sessionCaptor.capture());
        UserSession persisted = sessionCaptor.getValue();
        assertEquals(USER_ID, persisted.getUserId());
        assertEquals("refresh-hash", persisted.getRefreshTokenHash());
        assertEquals(NOW, persisted.getCreatedAt());
        assertEquals(NOW.plus(SESSION_LIFETIME), persisted.getExpiresAt());
        assertNull(persisted.getUserAgent());
        assertNull(persisted.getIpAddress());
    }

    @Test
    void propagatesTokenIssuanceFailureInsteadOfReturningPartialSuccess() {
        User user = user("real-hash", UserStatus.ACTIVE);
        when(userRepository.findByEmail("user@example.com")).thenReturn(Optional.of(user));
        when(passwordHasher.matches("password", "real-hash")).thenReturn(true);
        when(refreshTokenGenerator.generate()).thenReturn(new GeneratedRefreshToken("plain-refresh", "refresh-hash"));
        when(sessionRepository.save(any(UserSession.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(accessTokenIssuer.issue(eq(USER_ID), any(UUID.class), eq(SystemRole.USER), eq(UserStatus.ACTIVE)))
                .thenThrow(new IllegalStateException("issuer failed"));

        assertThrows(IllegalStateException.class,
                () -> useCase.execute(new LoginCommand("user@example.com", "password")));
        assertEquals(1, transactionRunner.invocations);
    }

    private UnauthorizedException assertUnauthorized() {
        return assertThrows(UnauthorizedException.class,
                () -> useCase.execute(new LoginCommand("user@example.com", "password")));
    }

    private static User user(String passwordHash, UserStatus status) {
        return new User(
                USER_ID,
                "User@Example.com",
                passwordHash,
                null,
                null,
                SystemRole.USER,
                status,
                NOW.minus(Duration.ofDays(1)),
                NOW.minus(Duration.ofHours(1))
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
