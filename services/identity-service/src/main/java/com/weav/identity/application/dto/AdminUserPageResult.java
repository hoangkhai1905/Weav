package com.weav.identity.application.dto;

import java.util.List;

public record AdminUserPageResult(
        List<AdminUserResult> items,
        int page,
        int size,
        long totalItems,
        int totalPages
) {
    public AdminUserPageResult {
        items = List.copyOf(items);
    }
}
