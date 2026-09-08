package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.OtpVerificationResult;
import com.weav.identity.application.dto.VerifyOtpCommand;
import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OtpChallengeStore;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.application.validation.OtpApplicationPolicy;
import com.weav.identity.application.validation.OtpInputPolicy;
import com.weav.identity.application.validation.OtpRateLimitException;
import com.weav.identity.domain.exception.BadRequestException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

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
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class VerifyOtpUseCaseTest {

    private static final String CHALLENGE_ID = "1234567890123456789012345678901234567890123";
    private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID SESSION_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final Instant NOW = Instant.parse("2026-09-08T04:00:00Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);

    private final UserRepository userRepository = mock(UserRepository.class);
    private final CurrentIdentityGuard identityGuard = mock(CurrentIdentityGuard.class);
    private final OtpChallengeStore challengeStore = mock(OtpChallengeStore.class);
    private final KeyedFingerprint fingerprint = mock(KeyedFingerprint.class);
    private final TransactionRunner transactionRunner = new ImmediateTransactionRunner();
    private VerifyOtpUseCase useCase;

    @BeforeEach
    void setUp() {
        when(challengeStore.reserve(anyString(), anyString(), any(Integer.class), any()))
                .thenReturn(new OtpChallengeStore.AdmissionResult(true, 0));
        when(fingerprint.fingerprint(anyString(), anyString()))
                .thenAnswer(invocation -> switch ((String) invocation.getArgument(0)) {
                    case "otp-ip" -> "ip-key";
                    case "otp-account" -> "account-key";
                    case "otp-credential" -> "credential-key";
                    case "otp-code" -> "code-key";
                    default -> throw new AssertionError("unexpected fingerprint namespace");
                });
        useCase = new VerifyOtpUseCase(
                userRepository,
                identityGuard,
                challengeStore,
                fingerprint,
                new AuthInputPolicy(),
                new OtpInputPolicy(),
                OtpApplicationPolicy.defaults(),
                transactionRunner,
                CLOCK
        );
    }

    @Test
    void verifiesPasswordResetAgainstFreshLockedCredentialAndReturnsGrant() {
        User user = user("password-hash", UserStatus.ACTIVE);
        OtpChallengeStore.ChallengeMetadata metadata = metadata(OtpChallengeStore.Purpose.PASSWORD_RESET, "credential-key");
        when(challengeStore.lookup(CHALLENGE_ID)).thenReturn(metadata);
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));
        when(challengeStore.verify(any())).thenReturn(new OtpChallengeStore.VerificationResult(
                OtpChallengeStore.Status.VERIFIED,
                OtpChallengeStore.Purpose.PASSWORD_RESET,
                USER_ID.toString(),
                "credential-key",
                "reset-grant",
                0
        ));

        OtpVerificationResult result = useCase.execute(new VerifyOtpCommand(
                CHALLENGE_ID, "123456", null, null, "127.0.0.1"));

        assertEquals(OtpChallengeStore.Purpose.PASSWORD_RESET, result.purpose());
        assertEquals("reset-grant", result.resetToken());
        assertEquals(300, result.expiresIn());
        verify(challengeStore).verify(any(OtpChallengeStore.VerificationAttempt.class));
    }

    @Test
    void emailVerificationRequiresSameActiveSessionAndSavesVerifiedAtAfterConsume() {
        User user = user(null, UserStatus.ACTIVE);
        OtpChallengeStore.ChallengeMetadata metadata = metadata(OtpChallengeStore.Purpose.EMAIL_VERIFICATION, "credential-key");
        when(challengeStore.lookup(CHALLENGE_ID)).thenReturn(metadata);
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));
        when(challengeStore.verify(any())).thenReturn(new OtpChallengeStore.VerificationResult(
                OtpChallengeStore.Status.VERIFIED,
                OtpChallengeStore.Purpose.EMAIL_VERIFICATION,
                USER_ID.toString(),
                "credential-key",
                null,
                0
        ));
        doNothing().when(identityGuard).requireActiveSessionForLockedUser(user, USER_ID, SESSION_ID);

        OtpVerificationResult result = useCase.execute(new VerifyOtpCommand(
                CHALLENGE_ID, "123456", USER_ID, SESSION_ID, "127.0.0.1"));

        assertEquals(OtpChallengeStore.Purpose.EMAIL_VERIFICATION, result.purpose());
        assertNull(result.resetToken());
        assertEquals(NOW, user.getEmailVerifiedAt());
        verify(identityGuard).requireActiveSessionForLockedUser(user, USER_ID, SESSION_ID);
        verify(userRepository).save(user);
    }

    @Test
    void changedCredentialInvalidatesChallengeBeforeAtomicVerify() {
        User user = user("new-password-hash", UserStatus.ACTIVE);
        OtpChallengeStore.ChallengeMetadata metadata = metadata(OtpChallengeStore.Purpose.PASSWORD_RESET, "old-credential-key");
        when(challengeStore.lookup(CHALLENGE_ID)).thenReturn(metadata);
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));

        assertThrows(BadRequestException.class, () -> useCase.execute(new VerifyOtpCommand(
                CHALLENGE_ID, "123456", null, null, "127.0.0.1")));

        verify(challengeStore, never()).verify(any());
    }

    @Test
    void wrongOrExpiredChallengeReturnsGenericInvalidChallenge() {
        User user = user("password-hash", UserStatus.ACTIVE);
        OtpChallengeStore.ChallengeMetadata metadata = metadata(OtpChallengeStore.Purpose.PASSWORD_RESET, "credential-key");
        when(challengeStore.lookup(CHALLENGE_ID)).thenReturn(metadata);
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));
        when(challengeStore.verify(any())).thenReturn(new OtpChallengeStore.VerificationResult(
                OtpChallengeStore.Status.WRONG_CODE,
                OtpChallengeStore.Purpose.PASSWORD_RESET,
                null,
                null,
                null,
                59
        ));

        BadRequestException failure = assertThrows(BadRequestException.class, () -> useCase.execute(new VerifyOtpCommand(
                CHALLENGE_ID, "123456", null, null, "127.0.0.1")));

        assertEquals("OTP challenge is invalid", failure.getMessage());
    }

    @Test
    void verificationIpLimitRejectsBeforeChallengeLookup() {
        when(challengeStore.reserve(anyString(), anyString(), any(Integer.class), any()))
                .thenReturn(new OtpChallengeStore.AdmissionResult(false, 31));

        OtpRateLimitException failure = assertThrows(OtpRateLimitException.class, () -> useCase.execute(new VerifyOtpCommand(
                CHALLENGE_ID, "123456", null, null, "127.0.0.1")));

        assertEquals(31, failure.getRetryAfterSeconds());
        verify(challengeStore, never()).lookup(anyString());
    }

    private static OtpChallengeStore.ChallengeMetadata metadata(
            OtpChallengeStore.Purpose purpose,
            String credentialFingerprint
    ) {
        return new OtpChallengeStore.ChallengeMetadata(
                CHALLENGE_ID,
                "account-key",
                purpose,
                USER_ID.toString(),
                credentialFingerprint
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
