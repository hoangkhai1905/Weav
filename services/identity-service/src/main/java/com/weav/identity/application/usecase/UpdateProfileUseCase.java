package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.AuthenticatedUserResult;
import com.weav.identity.application.dto.UpdateProfileCommand;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.domain.exception.BadRequestException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;

import java.time.Clock;
import java.util.Objects;
import java.util.UUID;

public final class UpdateProfileUseCase {

    private static final int MAX_DISPLAY_NAME_LENGTH = 120;

    private final CurrentIdentityGuard identityGuard;
    private final UserRepository userRepository;
    private final TransactionRunner transactionRunner;
    private final Clock clock;

    public UpdateProfileUseCase(
            CurrentIdentityGuard identityGuard,
            UserRepository userRepository,
            TransactionRunner transactionRunner,
            Clock clock
    ) {
        this.identityGuard = Objects.requireNonNull(identityGuard);
        this.userRepository = Objects.requireNonNull(userRepository);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.clock = Objects.requireNonNull(clock);
    }

    public AuthenticatedUserResult execute(UUID userId, UUID sessionId, UpdateProfileCommand command) {
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        Objects.requireNonNull(command, "command must not be null");
        String trimmed = command.displayName() == null || command.displayName().isBlank()
                ? null
                : command.displayName().trim();
        validateDisplayName(trimmed);
        identityGuard.requireActiveUser(userId, sessionId);

        return transactionRunner.required(() -> {
            User user = userRepository.findByIdForUpdate(userId)
                    .orElseThrow(() -> new IllegalStateException("Active user disappeared during profile update"));
            identityGuard.requireActiveSessionForLockedUser(user, userId, sessionId);
            user.updateDisplayName(trimmed, clock.instant());
            return AuthenticatedUserResult.from(userRepository.save(user));
        });
    }

    private static void validateDisplayName(String value) {
        if (value != null && value.length() > MAX_DISPLAY_NAME_LENGTH) {
            throw new BadRequestException("Display name must be at most " + MAX_DISPLAY_NAME_LENGTH + " characters");
        }
    }
}
