package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.ChangePasswordCommand;
import com.weav.identity.application.notification.IdentitySecurityEventType;
import com.weav.identity.application.notification.IdentitySecurityNotificationRecorder;
import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChangePasswordUseCaseTest {

    private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID SESSION_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final Instant NOW = Instant.parse("2026-09-27T04:05:06Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);

    private final UserRepository userRepository = mock(UserRepository.class);
    private final UserSessionRepository sessionRepository = mock(UserSessionRepository.class);
    private final PasswordHasher passwordHasher = mock(PasswordHasher.class);
    private final IdentitySecurityNotificationRecorder notificationRecorder =
            mock(IdentitySecurityNotificationRecorder.class);

    @Test
    void recordsAfterSuccessfulSameTextPasswordReplacementAndAllSessionRevocation() {
        User user = user("same-password-hash", UserStatus.ACTIVE);
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(user));
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Optional.of(activeSession()));
        when(passwordHasher.matches("same-password", "same-password-hash")).thenReturn(true);
        when(passwordHasher.hash("same-password")).thenReturn("replacement-password-hash");

        useCase().execute(USER_ID, SESSION_ID,
                new ChangePasswordCommand("same-password", "same-password"));

        InOrder order = inOrder(userRepository, sessionRepository, notificationRecorder);
        order.verify(userRepository).save(user);
        order.verify(sessionRepository).revokeAllForUser(USER_ID, NOW);
        order.verify(notificationRecorder).record(IdentitySecurityEventType.PASSWORD_CHANGED, USER_ID);
    }

    @Test
    void failedCurrentPasswordCheckDoesNotRecordSecurityMilestone() {
        User user = user("same-password-hash", UserStatus.ACTIVE);
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(user));
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Optional.of(activeSession()));
        when(passwordHasher.matches("wrong-password", "same-password-hash")).thenReturn(false);

        assertThrows(UnauthorizedException.class, () -> useCase().execute(
                USER_ID, SESSION_ID,
                new ChangePasswordCommand("wrong-password", "replacement-password")));

        verify(userRepository, never()).save(user);
        verify(sessionRepository, never()).revokeAllForUser(USER_ID, NOW);
        verify(notificationRecorder, never()).record(IdentitySecurityEventType.PASSWORD_CHANGED, USER_ID);
    }

    private ChangePasswordUseCase useCase() {
        CurrentIdentityGuard identityGuard = new CurrentIdentityGuard(userRepository, sessionRepository, CLOCK);
        return new ChangePasswordUseCase(
                identityGuard,
                userRepository,
                sessionRepository,
                passwordHasher,
                new ImmediateTransactionRunner(),
                new AuthInputPolicy(),
                CLOCK,
                notificationRecorder);
    }

    private static User user(String passwordHash, UserStatus status) {
        return new User(
                USER_ID,
                "person@example.com",
                passwordHash,
                "Person",
                null,
                SystemRole.USER,
                status,
                NOW.minusSeconds(60),
                NOW.minusSeconds(30));
    }

    private static UserSession activeSession() {
        return new UserSession(
                SESSION_ID,
                USER_ID,
                "refresh-hash",
                "JUnit",
                "127.0.0.1",
                NOW.plusSeconds(600),
                NOW.minusSeconds(60));
    }

    private static final class ImmediateTransactionRunner implements TransactionRunner {
        @Override
        public <T> T required(Supplier<T> work) {
            return work.get();
        }
    }
}
