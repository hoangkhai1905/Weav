package com.weav.identity.presentation.http.response;

import java.util.List;

public record SessionPageResponse(
        List<SessionResponse> items,
        int page,
        int size,
        long totalItems,
        int totalPages
) {
}
