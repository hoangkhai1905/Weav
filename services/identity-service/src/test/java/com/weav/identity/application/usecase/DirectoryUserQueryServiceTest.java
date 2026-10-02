package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.UserDirectoryPage;
import com.weav.identity.application.dto.UserDirectorySummary;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.domain.exception.BadRequestException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class DirectoryUserQueryServiceTest {

    private static final Instant NOW = Instant.parse("2026-01-02T03:04:05Z");
    private static final UUID FIRST = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID SECOND = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID THIRD = UUID.fromString("00000000-0000-0000-0000-000000000003");
    private static final UUID FOURTH = UUID.fromString("00000000-0000-0000-0000-000000000004");

    @Test
    void exactEmailLookupIncludesInactiveSummary() {
        UserRepository repository = mock(UserRepository.class);
        User inactive = user(SECOND, "Disabled@Example.com", null, UserStatus.DISABLED);
        when(repository.findByEmail("disabled@example.com")).thenReturn(java.util.Optional.of(inactive));

        UserDirectorySummary result = service(repository)
                .findByEmail("  DISABLED@example.COM ").orElseThrow();

        assertEquals(SECOND, result.userId());
        assertEquals("Disabled@Example.com", result.email());
        assertFalse(result.active());
    }

    @Test
    void candidateMatchingNeverReturnsIdsOutsideTheCandidateSet() {
        UserRepository repository = mock(UserRepository.class);
        when(repository.findAllByIds(anyCollection())).thenReturn(List.of(
                user(FIRST, "one@example.com", "Same", UserStatus.ACTIVE),
                user(SECOND, "two@example.com", "Same", UserStatus.ACTIVE),
                user(THIRD, "other@example.com", "Unrelated", UserStatus.ACTIVE)));

        Set<UUID> matching = service(repository)
                .matchUserIds(List.of(FIRST, SECOND), "same");

        assertEquals(Set.of(FIRST, SECOND), matching);
    }

    @Test
    void displayNameSearchSortsNullsLastAndUsesUserIdTieBreakInBothDirections() {
        UserRepository repository = mock(UserRepository.class);
        when(repository.findAllByIds(anyCollection())).thenReturn(List.of(
                user(THIRD, "three@example.com", null, UserStatus.ACTIVE),
                user(SECOND, "two@example.com", "same", UserStatus.ACTIVE),
                user(FIRST, "one@example.com", "Same", UserStatus.ACTIVE),
                user(FOURTH, "four@example.com", "Zulu", UserStatus.ACTIVE)));

        DirectoryUserQueryService service = service(repository);
        UserDirectoryPage ascending = service.searchUsers(
                List.of(FIRST, SECOND, THIRD, FOURTH), null, 0, 10, "asc");
        UserDirectoryPage descending = service.searchUsers(
                List.of(FIRST, SECOND, THIRD, FOURTH), null, 0, 10, "desc");

        assertEquals(List.of(FIRST, SECOND, FOURTH, THIRD), ascending.items().stream()
                .map(UserDirectorySummary::userId).toList());
        assertEquals(List.of(FOURTH, FIRST, SECOND, THIRD), descending.items().stream()
                .map(UserDirectorySummary::userId).toList());
        assertEquals(4, ascending.totalElements());
        assertEquals(1, ascending.totalPages());
    }

    @Test
    void emptyCandidateSetShortCircuitsEveryDirectoryQuery() {
        UserRepository repository = mock(UserRepository.class);
        DirectoryUserQueryService service = service(repository);

        assertTrue(service.matchUserIds(List.of(), "search").isEmpty());
        assertTrue(service.searchUsers(List.of(), "search", 0, 20, "asc").items().isEmpty());
        assertTrue(service.getUsersByIds(List.of()).isEmpty());
    }

    @Test
    void rejectsInvalidEmailBeforeRepositoryLookup() {
        UserRepository repository = mock(UserRepository.class);
        DirectoryUserQueryService service = service(repository);

        for (String email : List.of(
                "not-an-email",
                "user name@example.com",
                "usér@example.com",
                "a".repeat(321) + "@example.com")) {
            assertThrows(BadRequestException.class, () -> service.findByEmail(email));
        }

        verifyNoInteractions(repository);
    }

    private static DirectoryUserQueryService service(UserRepository repository) {
        return new DirectoryUserQueryService(repository, new AuthInputPolicy());
    }

    private static User user(UUID id, String email, String displayName, UserStatus status) {
        return new User(
                id,
                email,
                "hash",
                displayName,
                null,
                SystemRole.USER,
                status,
                NOW,
                NOW);
    }
}
