package com.weav.identity.domain.model;

import java.util.List;

public record UserPage(
        List<User> items,
        int page,
        int size,
        long totalItems,
        int totalPages
) {
    public UserPage {
        items = List.copyOf(items);
    }
}
