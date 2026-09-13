package com.weav.identity.infrastructure.persistence;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.usecase.DirectoryUserQueryService;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.infrastructure.persistence.repository.SpringDataUserRepository;
import com.weav.identity.infrastructure.persistence.repository.UserRepositoryAdapter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class DirectoryUserQueryIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-01-02T03:04:05Z");

    @Autowired
    private UserRepositoryAdapter userRepository;

    @Autowired
    private SpringDataUserRepository springDataUserRepository;

    @Autowired
    private DirectoryUserQueryService directoryUserQueryService;

    @BeforeEach
    void cleanDatabase() {
        springDataUserRepository.deleteAll();
    }

    @Test
    void postgresDirectoryQueriesPreserveInactiveStateAndStableOrdering() {
        UUID first = UUID.fromString("00000000-0000-0000-0000-000000000001");
        UUID second = UUID.fromString("00000000-0000-0000-0000-000000000002");
        UUID third = UUID.fromString("00000000-0000-0000-0000-000000000003");
        userRepository.save(user(first, "first@example.com", "Same", UserStatus.ACTIVE));
        userRepository.save(user(second, "second@example.com", "same", UserStatus.DISABLED));
        userRepository.save(user(third, "third@example.com", null, UserStatus.ACTIVE));

        var page = directoryUserQueryService.searchUsers(
                List.of(third, second, first), "same", 0, 20, "desc");
        var inactive = directoryUserQueryService.findByEmail(" SECOND@example.com ").orElseThrow();

        assertEquals(List.of(first, second), page.items().stream().map(item -> item.userId()).toList());
        assertEquals(2, page.totalElements());
        assertFalse(inactive.active());
    }

    private static User user(UUID id, String email, String displayName, UserStatus status) {
        return new User(id, email, "hash", displayName, null, SystemRole.USER, status, NOW, NOW);
    }
}
