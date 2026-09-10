package com.weav.identity.application.dto;

import java.util.List;

public record SessionPageResult(
        List<SessionResult> items,
        int page,
        int size,
        long totalItems,
        int totalPages
) {
}
