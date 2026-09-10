package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.ResetPasswordCommand;
import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OtpChallengeStore;
import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.application.validation.OtpInputPolicy;
import com.weav.identity.domain.exception.BadRequestException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ResetPasswordUseCaseTest {

    private static final String RESET_TOKEN = "1234567890123456789012345678901234567890123";
    private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant NOW = Instant.parse("2026-09-08T04:00:00Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);

    private final UserRepository userRepository = mock(UserRepository.class);
    private final UserSessionRepository sessionRepository = mock(UserSessionRepository.class);
    private final OtpChallengeStore challengeStore = mock(OtpChallengeStore.class);
    private final KeyedFingerprint fingerprint = mock(KeyedFingerprint.class);
    private final PasswordHasher passwordHasher = mock(PasswordHasher.class);
    private final TransactionRunner transactionRunner = new ImmediateTransactionRunner();
    private ResetPasswordUseCase useCase;

    @BeforeEach
    void setUp() {
        when(fingerprint.fingerprint(anyString(), anyString()))
                .thenAnswer(invocation -> switch ((String) invocation.getArgument(0)) {
                    case "otp-account" -> "account-key";
                    case "otp-credential" -> "old-password-hash".equals(invocation.getArgument(1))
                            ? "credential-key"
                            : "different-credential-key";
                    default -> throw new AssertionError("unexpected fingerprint namespace");
                });
        useCase = new ResetPasswordUseCase(
                userRepository,
                sessionRepository,
                challengeStore,
                fingerprint,
                passwordHasher,
                transactionRunner,
                new AuthInputPolicy(),
                new OtpInputPolicy(),
                CLOCK
        );
    }

    @Test
    void hashesBeforeConsumingGrantAndUpdatesPasswordVerificationAndSessionsInTransaction() {
        User user = user("old-password-hash", UserStatus.ACTIVE);
        when(passwordHasher.hash("new-password")).thenReturn("new-password-hash");
        when(challengeStore.consumeGrant(RESET_TOKEN)).thenReturn(grant());
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));

        useCase.execute(new ResetPasswordCommand(RESET_TOKEN, "new-password"));

        InOrder order = inOrder(passwordHasher, challengeStore, userRepository, sessionRepository);
        order.verify(challengeStore).consumeGrant(RESET_TOKEN);
        order.verify(passwordHasher).hash("new-password");
        order.verify(userRepository).findByIdForUpdate(USER_ID);
        order.verify(sessionRepository).revokeAllForUser(USER_ID, NOW);
        assertEquals("new-password-hash", user.getPasswordHash());
        assertEquals(NOW, user.getEmailVerifiedAt());
    }

    @Test
    void changedCredentialOrEmailInvalidatesConsumedGrantWithoutMutation() {
        User user = user("different-password-hash", UserStatus.ACTIVE);
        when(passwordHasher.hash("new-password")).thenReturn("new-password-hash");
        when(challengeStore.consumeGrant(RESET_TOKEN)).thenReturn(grant());
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));

        assertThrows(BadRequestException.class,
                () -> useCase.execute(new ResetPasswordCommand(RESET_TOKEN, "new-password")));

        verify(userRepository, never()).save(any(User.class));
        verify(sessionRepository, never()).revokeAllForUser(any(), any());
    }

    @Test
    void databaseFailureAfterGrantConsumptionIsPropagatedWithoutRestoringGrant() {
        User user = user("old-password-hash", UserStatus.ACTIVE);
        TransactionRunner failingTransaction = new TransactionRunner() {
            @Override
            public <T> T required(Supplier<T> work) {
                work.get();
                throw new IllegalStateException("database commit failed");
            }
        };
        useCase = new ResetPasswordUseCase(
                userRepository,
                sessionRepository,
                challengeStore,
                fingerprint,
                passwordHasher,
                failingTransaction,
                new AuthInputPolicy(),
                new OtpInputPolicy(),
                CLOCK
        );
        when(passwordHasher.hash("new-password")).thenReturn("new-password-hash");
        when(challengeStore.consumeGrant(RESET_TOKEN)).thenReturn(grant());
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));

        assertThrows(IllegalStateException.class,
                () -> useCase.execute(new ResetPasswordCommand(RESET_TOKEN, "new-password")));

        verify(challengeStore).consumeGrant(RESET_TOKEN);
    }

    @Test
    void rejectsInvalidPasswordBeforeHashAndGrantConsumption() {
        assertThrows(BadRequestException.class,
                () -> useCase.execute(new ResetPasswordCommand(RESET_TOKEN, "short")));

        verify(passwordHasher, never()).hash(anyString());
        verify(challengeStore, never()).consumeGrant(anyString());
    }

    @Test
    void rejectsUnconsumedOrOauthOnlyGrantGenerically() {
        when(passwordHasher.hash("new-password")).thenReturn("new-password-hash");
        when(challengeStore.consumeGrant(RESET_TOKEN)).thenReturn(new OtpChallengeStore.GrantConsumptionResult(
                false, null, null, null, null));

        assertThrows(BadRequestException.class,
                () -> useCase.execute(new ResetPasswordCommand(RESET_TOKEN, "new-password")));

        User oauthOnly = user(null, UserStatus.ACTIVE);
        when(challengeStore.consumeGrant(RESET_TOKEN)).thenReturn(grant());
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(oauthOnly));

        assertThrows(BadRequestException.class,
                () -> useCase.execute(new ResetPasswordCommand(RESET_TOKEN, "new-password")));
        verify(userRepository, never()).save(any(User.class));
    }

    private static OtpChallengeStore.GrantConsumptionResult grant() {
        return new OtpChallengeStore.GrantConsumptionResult(
                true,
                "account-key",
                OtpChallengeStore.Purpose.PASSWORD_RESET,
                USER_ID.toString(),
                "credential-key"
        );
    }

    private static User user(String passwordHash, UserStatus status) {
        return new User(
                USER_ID,
                "user@example.com",
                passwordHash,
                null,
                null,
                SystemRole.USER,
                status,
                NOW.minusSeconds(60),
                NOW.minusSeconds(30)
        );
    }

    private static final class ImmediateTransactionRunner implements TransactionRunner {
        @Override
        public <T> T required(Supplier<T> work) {
            return work.get();
        }
    }
}
