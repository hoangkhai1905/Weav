package com.weav.identity.domain.model;

import java.util.List;
import java.util.Objects;

/**
 * A framework-free page of sessions owned by a single user.
 */
public record UserSessionPage(
        List<UserSession> items,
        int page,
        int size,
        long totalItems,
        int totalPages
) {

    public UserSessionPage {
        items = List.copyOf(Objects.requireNonNull(items, "items must not be null"));
        if (page < 0) {
            throw new IllegalArgumentException("page must not be negative");
        }
        if (size < 1) {
            throw new IllegalArgumentException("size must be positive");
        }
        if (totalItems < 0) {
            throw new IllegalArgumentException("totalItems must not be negative");
        }
        if (totalPages < 0) {
            throw new IllegalArgumentException("totalPages must not be negative");
        }
    }
}
