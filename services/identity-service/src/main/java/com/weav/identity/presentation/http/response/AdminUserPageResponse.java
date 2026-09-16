package com.weav.identity.presentation.http.response;

import java.util.List;

public record AdminUserPageResponse(
        List<AdminUserResponse> items,
        int page,
        int size,
        long totalItems,
        int totalPages
) {
    public AdminUserPageResponse {
        items = List.copyOf(items);
    }
}
