package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.AdminUserPageResult;
import com.weav.identity.application.dto.AdminUserResult;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.domain.exception.BadRequestException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserPage;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.valueobject.UserStatus;

import java.util.Objects;
import java.util.UUID;

public final class ListUsersUseCase {

    private static final int MAX_SEARCH_LENGTH = 120;

    private final CurrentIdentityGuard identityGuard;
    private final UserRepository userRepository;
    private final TransactionRunner transactionRunner;

    public ListUsersUseCase(
            CurrentIdentityGuard identityGuard,
            UserRepository userRepository,
            TransactionRunner transactionRunner
    ) {
        this.identityGuard = Objects.requireNonNull(identityGuard);
        this.userRepository = Objects.requireNonNull(userRepository);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
    }

    public AdminUserPageResult execute(
            UUID actorId,
            UUID sessionId,
            String search,
            UserStatus status,
            int page,
            int size
    ) {
        Objects.requireNonNull(actorId, "actorId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        validatePage(page, size);
        String normalizedSearch = normalizeSearch(search);

        return transactionRunner.required(() -> {
            User actor = userRepository.findByIdForUpdate(actorId).orElse(null);
            identityGuard.requireActiveAdminForLockedUser(actor, actorId, sessionId);
            UserPage result = userRepository.findPage(normalizedSearch, status, page, size);
            return new AdminUserPageResult(
                    result.items().stream().map(AdminUserResult::from).toList(),
                    result.page(),
                    result.size(),
                    result.totalItems(),
                    result.totalPages());
        });
    }

    static String normalizeSearch(String search) {
        if (search == null || search.isBlank()) {
            return "";
        }
        String trimmed = search.trim();
        if (trimmed.length() > MAX_SEARCH_LENGTH) {
            throw new BadRequestException("search must be at most " + MAX_SEARCH_LENGTH + " characters");
        }
        return trimmed;
    }

    static void validatePage(int page, int size) {
        if (page < 0) {
            throw new BadRequestException("page must not be negative");
        }
        if (size < 1 || size > 100) {
            throw new BadRequestException("size must be between 1 and 100");
        }
    }
}
