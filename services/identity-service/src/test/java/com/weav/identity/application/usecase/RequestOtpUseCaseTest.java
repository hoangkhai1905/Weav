package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.OtpReceipt;
import com.weav.identity.application.dto.RequestOtpCommand;
import com.weav.identity.application.port.out.AuthMailDispatcher;
import com.weav.identity.application.port.out.AuthMailSender;
import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OtpChallengeStore;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.application.validation.OtpApplicationPolicy;
import com.weav.identity.application.validation.OtpInputPolicy;
import com.weav.identity.application.validation.OtpRateLimitException;
import com.weav.identity.domain.exception.BadRequestException;
import com.weav.identity.domain.exception.DependencyUnavailableException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RequestOtpUseCaseTest {

    private static final String CHALLENGE_ID = "1234567890123456789012345678901234567890123";
    private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID SESSION_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final Instant NOW = Instant.parse("2026-09-08T04:00:00Z");

    private final UserRepository userRepository = mock(UserRepository.class);
    private final CurrentIdentityGuard identityGuard = mock(CurrentIdentityGuard.class);
    private final OtpChallengeStore challengeStore = mock(OtpChallengeStore.class);
    private final KeyedFingerprint fingerprint = mock(KeyedFingerprint.class);
    private final AuthMailDispatcher mailDispatcher = mock(AuthMailDispatcher.class);
    private final AuthMailDispatcher.Lease lease = mock(AuthMailDispatcher.Lease.class);
    private final SecureRandom secureRandom = new FixedSecureRandom();
    private RequestOtpUseCase useCase;

    @BeforeEach
    void setUp() {
        when(mailDispatcher.reserve()).thenReturn(lease);
        when(challengeStore.reserve(anyString(), anyString(), anyInt(), any()))
                .thenReturn(new OtpChallengeStore.AdmissionResult(true, 0));
        when(fingerprint.fingerprint(anyString(), anyString()))
                .thenAnswer(invocation -> invocation.getArgument(0) + ":" + invocation.getArgument(1));
        useCase = new RequestOtpUseCase(
                userRepository,
                identityGuard,
                challengeStore,
                fingerprint,
                mailDispatcher,
                new AuthInputPolicy(),
                new OtpInputPolicy(),
                OtpApplicationPolicy.defaults(),
                secureRandom
        );
    }

    @Test
    void reservesQueueAndDistributedAdmissionBeforeLookingUpPublicAccount() {
        User user = user("password-hash", UserStatus.ACTIVE);
        when(userRepository.findByEmail("user@example.com")).thenReturn(Optional.of(user));
        when(challengeStore.newChallengeId()).thenReturn(CHALLENGE_ID);
        when(challengeStore.issue(any())).thenReturn(new OtpChallengeStore.ChallengeReceipt(true, false, 300));

        OtpReceipt receipt = useCase.execute(new RequestOtpCommand(
                OtpChallengeStore.Purpose.PASSWORD_RESET,
                " User@Example.com ",
                null,
                null,
                "127.0.0.1"
        ));

        assertEquals(CHALLENGE_ID, receipt.challengeId());
        assertEquals(300, receipt.expiresIn());
        assertEquals(60, receipt.retryAfter());
        InOrder order = inOrder(mailDispatcher, challengeStore, userRepository);
        order.verify(mailDispatcher).reserve();
        order.verify(challengeStore).reserve(eq("otp:ip"), anyString(), eq(20), eq(Duration.ofHours(1)));
        order.verify(challengeStore).reserve(eq("otp:cooldown"), anyString(), eq(1), eq(Duration.ofSeconds(60)));
        order.verify(challengeStore).reserve(eq("otp:account"), anyString(), eq(5), eq(Duration.ofHours(1)));
        order.verify(userRepository).findByEmail("user@example.com");

        ArgumentCaptor<AuthMailSender.Message> messageCaptor = ArgumentCaptor.forClass(AuthMailSender.Message.class);
        verify(lease).dispatch(messageCaptor.capture(), any(Runnable.class));
        assertTrue(messageCaptor.getValue().body().contains("000042"));
        assertTrue(messageCaptor.getValue().toString().contains("<redacted>"));
    }

    @Test
    void nonEligiblePublicAccountGetsSameNoOpAdmissionAndReceiptShape() {
        when(userRepository.findByEmail("unknown@example.com")).thenReturn(Optional.empty());
        when(challengeStore.newChallengeId()).thenReturn(CHALLENGE_ID);

        OtpReceipt receipt = useCase.execute(new RequestOtpCommand(
                OtpChallengeStore.Purpose.PASSWORD_RESET,
                "unknown@example.com",
                null,
                null,
                "127.0.0.1"
        ));

        assertEquals(CHALLENGE_ID.length(), receipt.challengeId().length());
        verify(challengeStore).invalidatePurpose(anyString(), eq(OtpChallengeStore.Purpose.PASSWORD_RESET));
        verify(lease).dispatch(null, null);
        verify(challengeStore, never()).issue(any());
    }

    @Test
    void disabledAndOauthOnlyAccountsDoNotReceiveMail() {
        User disabled = user("password-hash", UserStatus.DISABLED);
        User oauthOnly = user(null, UserStatus.ACTIVE);
        when(userRepository.findByEmail("user@example.com"))
                .thenReturn(Optional.of(disabled), Optional.of(oauthOnly));
        when(challengeStore.newChallengeId()).thenReturn(CHALLENGE_ID, CHALLENGE_ID);

        useCase.execute(new RequestOtpCommand(
                OtpChallengeStore.Purpose.PASSWORD_RESET, "user@example.com", null, null, "127.0.0.1"));
        useCase.execute(new RequestOtpCommand(
                OtpChallengeStore.Purpose.PASSWORD_RESET, "user@example.com", null, null, "127.0.0.1"));

        verify(lease, org.mockito.Mockito.times(2)).dispatch(null, null);
        verify(challengeStore, org.mockito.Mockito.times(2))
                .invalidatePurpose(anyString(), eq(OtpChallengeStore.Purpose.PASSWORD_RESET));
        verify(challengeStore, never()).issue(any());
    }

    @Test
    void emailVerificationUsesCurrentAuthenticatedUserEmailAndSession() {
        User user = user(null, UserStatus.ACTIVE);
        when(identityGuard.requireActiveUser(USER_ID, SESSION_ID)).thenReturn(user);
        when(challengeStore.newChallengeId()).thenReturn(CHALLENGE_ID);
        when(challengeStore.issue(any())).thenReturn(new OtpChallengeStore.ChallengeReceipt(true, false, 300));

        useCase.execute(new RequestOtpCommand(
                OtpChallengeStore.Purpose.EMAIL_VERIFICATION,
                null,
                USER_ID,
                SESSION_ID,
                "127.0.0.1"
        ));

        verify(identityGuard).requireActiveUser(USER_ID, SESSION_ID);
        verify(userRepository, never()).findByEmail(anyString());
        verify(lease).dispatch(any(AuthMailSender.Message.class), any(Runnable.class));
    }

    @Test
    void rejectsEmailOverrideForEmailVerification() {
        assertThrows(BadRequestException.class, () -> useCase.execute(new RequestOtpCommand(
                OtpChallengeStore.Purpose.EMAIL_VERIFICATION,
                "other@example.com",
                USER_ID,
                SESSION_ID,
                "127.0.0.1"
        )));

        verify(mailDispatcher, never()).reserve();
    }

    @Test
    void rejectsAdmissionBeforePublicAccountLookup() {
        when(challengeStore.reserve(anyString(), anyString(), anyInt(), any()))
                .thenReturn(new OtpChallengeStore.AdmissionResult(false, 37));

        OtpRateLimitException failure = assertThrows(OtpRateLimitException.class, () -> useCase.execute(
                new RequestOtpCommand(
                        OtpChallengeStore.Purpose.PASSWORD_RESET,
                        "user@example.com",
                        null,
                        null,
                        "127.0.0.1"
                )));

        assertEquals(37, failure.getRetryAfterSeconds());
        verify(userRepository, never()).findByEmail(anyString());
        verify(lease).close();
    }

    @Test
    void queueDependencyFailureHappensBeforePublicAccountLookup() {
        when(mailDispatcher.reserve()).thenThrow(new DependencyUnavailableException());

        assertThrows(DependencyUnavailableException.class, () -> useCase.execute(new RequestOtpCommand(
                OtpChallengeStore.Purpose.PASSWORD_RESET,
                "user@example.com",
                null,
                null,
                "127.0.0.1"
        )));

        verify(userRepository, never()).findByEmail(anyString());
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

    private static final class FixedSecureRandom extends SecureRandom {
        @Override
        public int nextInt(int bound) {
            return 42;
        }
    }
}
