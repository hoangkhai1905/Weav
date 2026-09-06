package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.RefreshTokenCommand;
import com.weav.identity.application.port.out.RefreshTokenGenerator;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.port.out.UserSessionRepository;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LogoutUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-09-05T10:15:30Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID SESSION_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final String SUBMITTED_TOKEN = "submitted-refresh-token";
    private static final String SUBMITTED_HASH = "submitted-refresh-hash";

    private final UserSessionRepository sessionRepository = mock(UserSessionRepository.class);
    private final RefreshTokenGenerator refreshTokenGenerator = mock(RefreshTokenGenerator.class);
    private final TrackingTransactionRunner transactionRunner = new TrackingTransactionRunner();
    private final LogoutUseCase useCase = new LogoutUseCase(
            sessionRepository,
            refreshTokenGenerator,
            transactionRunner,
            CLOCK
    );

    @Test
    void revokesAndPersistsActiveSessionInsideTransaction() {
        UserSession session = session(null);
        when(refreshTokenGenerator.hash(SUBMITTED_TOKEN)).thenReturn(SUBMITTED_HASH);
        when(sessionRepository.findByRefreshTokenHashForUpdate(SUBMITTED_HASH))
                .thenReturn(Optional.of(session));
        when(sessionRepository.save(session)).thenAnswer(invocation -> {
            assertTrue(transactionRunner.inTransaction);
            return invocation.getArgument(0);
        });

        useCase.execute(new RefreshTokenCommand(SUBMITTED_TOKEN));

        assertEquals(1, transactionRunner.invocations);
        assertEquals(NOW, session.getRevokedAt());
        verify(sessionRepository).save(session);
    }

    @Test
    void treatsRepeatedLogoutForUnknownTokenAsSuccessfulNoOp() {
        when(refreshTokenGenerator.hash(SUBMITTED_TOKEN)).thenReturn(SUBMITTED_HASH);
        when(sessionRepository.findByRefreshTokenHashForUpdate(SUBMITTED_HASH))
                .thenReturn(Optional.empty());

        assertDoesNotThrow(() -> useCase.execute(new RefreshTokenCommand(SUBMITTED_TOKEN)));
        assertDoesNotThrow(() -> useCase.execute(new RefreshTokenCommand(SUBMITTED_TOKEN)));

        assertEquals(2, transactionRunner.invocations);
        verify(sessionRepository, never()).save(any(UserSession.class));
    }

    @Test
    void preservesOriginalRevocationTimeWhenLogoutIsRepeated() {
        Instant originallyRevokedAt = NOW.minus(Duration.ofHours(2));
        UserSession session = session(originallyRevokedAt);
        when(refreshTokenGenerator.hash(SUBMITTED_TOKEN)).thenReturn(SUBMITTED_HASH);
        when(sessionRepository.findByRefreshTokenHashForUpdate(SUBMITTED_HASH))
                .thenReturn(Optional.of(session));
        when(sessionRepository.save(session)).thenAnswer(invocation -> invocation.getArgument(0));

        assertDoesNotThrow(() -> useCase.execute(new RefreshTokenCommand(SUBMITTED_TOKEN)));
        assertDoesNotThrow(() -> useCase.execute(new RefreshTokenCommand(SUBMITTED_TOKEN)));

        assertEquals(originallyRevokedAt, session.getRevokedAt());
        assertEquals(2, transactionRunner.invocations);
        verify(sessionRepository, times(2)).save(session);
    }

    private static UserSession session(Instant revokedAt) {
        return new UserSession(
                SESSION_ID,
                USER_ID,
                SUBMITTED_HASH,
                "test-agent",
                "127.0.0.1",
                NOW.plus(Duration.ofDays(1)),
                revokedAt,
                NOW.minus(Duration.ofHours(1)),
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
