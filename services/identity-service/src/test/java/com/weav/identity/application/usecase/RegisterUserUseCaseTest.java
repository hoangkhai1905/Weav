package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.AuthenticatedUserResult;
import com.weav.identity.application.dto.RegisterUserCommand;
import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.domain.exception.BadRequestException;
import com.weav.identity.domain.exception.ConflictException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.lang.reflect.RecordComponent;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RegisterUserUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-09-05T10:15:30Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);

    private final UserRepository userRepository = mock(UserRepository.class);
    private final PasswordHasher passwordHasher = mock(PasswordHasher.class);
    private final RegisterUserUseCase useCase = new RegisterUserUseCase(
            userRepository,
            passwordHasher,
            new ImmediateTransactionRunner(),
            new AuthInputPolicy(),
            CLOCK
    );

    @Test
    void registersCanonicalUserWithServerSelectedRoleAndPublicResultOnly() {
        when(passwordHasher.hash("unchanged-password")).thenReturn("encoded-password");
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));

        AuthenticatedUserResult result = useCase.execute(
                new RegisterUserCommand("  USER@Example.COM  ", "unchanged-password", null)
        );

        ArgumentCaptor<User> userCaptor = ArgumentCaptor.forClass(User.class);
        verify(userRepository).existsByEmail("user@example.com");
        verify(passwordHasher).hash("unchanged-password");
        verify(userRepository).save(userCaptor.capture());

        User persisted = userCaptor.getValue();
        assertEquals("user@example.com", persisted.getEmail());
        assertEquals("encoded-password", persisted.getPasswordHash());
        assertNull(persisted.getDisplayName());
        assertNull(persisted.getAvatarStorageKey());
        assertEquals(SystemRole.USER, persisted.getSystemRole());
        assertEquals(UserStatus.ACTIVE, persisted.getStatus());
        assertEquals(NOW, persisted.getCreatedAt());
        assertEquals(NOW, persisted.getUpdatedAt());

        assertEquals(persisted.getId(), result.id());
        assertEquals("user@example.com", result.email());
        assertNull(result.displayName());
        assertNull(result.avatarStorageKey());
        assertEquals(SystemRole.USER, result.systemRole());
        assertEquals(UserStatus.ACTIVE, result.status());
        assertFalse(hasRecordComponent(RegisterUserCommand.class, "systemRole"));
        assertFalse(hasRecordComponent(RegisterUserCommand.class, "status"));
        assertFalse(hasRecordComponent(RegisterUserCommand.class, "passwordHash"));
        assertFalse(hasRecordComponent(AuthenticatedUserResult.class, "passwordHash"));
    }

    @Test
    void rejectsCanonicalDuplicateEmail() {
        when(passwordHasher.hash("password")).thenReturn("encoded-password");
        when(userRepository.existsByEmail("user@example.com")).thenReturn(true);

        assertThrows(ConflictException.class, () -> useCase.execute(
                new RegisterUserCommand(" User@Example.com ", "password", "User")
        ));

        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    void rejectsNonAsciiOrNonBoundaryWhitespaceInEmail() {
        assertThrows(BadRequestException.class, () -> useCase.execute(
                new RegisterUserCommand("user\t@example.com", "password", null)
        ));
        assertThrows(BadRequestException.class, () -> useCase.execute(
                new RegisterUserCommand("usér@example.com", "password", null)
        ));
        assertThrows(BadRequestException.class, () -> useCase.execute(
                new RegisterUserCommand("user @example.com", "password", null)
        ));
    }

    @Test
    void preservesPasswordAndEnforcesCharacterAndUtf8ByteBounds() {
        when(passwordHasher.hash("  secret")).thenReturn("encoded-spaced-password");
        when(passwordHasher.hash("é".repeat(36))).thenReturn("encoded-multibyte-password");
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));

        useCase.execute(new RegisterUserCommand("first@example.com", "  secret", null));
        useCase.execute(new RegisterUserCommand("second@example.com", "é".repeat(36), null));

        verify(passwordHasher).hash("  secret");
        verify(passwordHasher).hash("é".repeat(36));
        assertThrows(BadRequestException.class, () -> useCase.execute(
                new RegisterUserCommand("third@example.com", "1234567", null)
        ));
        assertThrows(BadRequestException.class, () -> useCase.execute(
                new RegisterUserCommand("fourth@example.com", "a".repeat(73), null)
        ));
        assertThrows(BadRequestException.class, () -> useCase.execute(
                new RegisterUserCommand("fifth@example.com", "é".repeat(37), null)
        ));
    }

    private static boolean hasRecordComponent(Class<?> type, String name) {
        return Arrays.stream(type.getRecordComponents())
                .map(RecordComponent::getName)
                .anyMatch(name::equals);
    }

    private static final class ImmediateTransactionRunner implements TransactionRunner {
        @Override
        public <T> T required(Supplier<T> work) {
            return work.get();
        }
    }
}
